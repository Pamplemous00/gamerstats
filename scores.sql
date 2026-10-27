-- =====================================================================
-- Gamer Stats — calcul des scores.
-- À exécuter dans Supabase > SQL Editor APRÈS accounts_rls.sql et seed_lichess.sql.
-- Modes avec répartition officielle (Lichess, table rating_distributions) : le « top »
-- vient de gs_dist_top() (tous les joueurs actifs) au lieu de l'échantillon.
-- Modes avec table de correspondance (Lichess, lichess_conversion.sql) : l'Elo équivalent
-- vient de gs_convert_elo() (table ChessGoals) et non du top. Lancer lichess_conversion.sql avant.
-- Peut être relancé sans risque (par exemple après avoir changé un réglage).
--
-- Monnaie commune du site : l'« Elo équivalent Blitz Chess.com ».
-- Pour chaque mode (version du 23/10/2026) :
--   1. « top » du joueur = part des joueurs récents du mode qui font mieux que lui.
--      - jusqu'au top 10 % : comparaison directe avec l'échantillon ;
--      - au-delà (l'élite) : on prolonge la courbe. Au-dessus du seuil du top 10 % (r90),
--        le nombre de joueurs est divisé par e tous les `s` points, où s = écart moyen
--        des joueurs du top 10 % au-dessus de r90 :  top = 10 % × exp(−(rating − r90) / s).
--   2. Correction de fiabilité sur l'échelle logit (forte si peu de joueurs,
--      sans plafonner l'élite) : logit(top ajusté) = logit(top) × n / (n + K).
--   3. Elo équivalent = Elo Blitz qui a ce même top ajusté (même modèle côté Blitz).
--      Blitz Chess.com (la référence) : Elo équivalent = Elo du joueur.
--      Plafond : 3 500 (≈ n°1 mondial des échecs).
--   4. points = 200 × 2^(Elo équivalent / 500) × difficulty_factor du jeu.
-- Score d'un jeu    = meilleurs points parmi ses modes.
-- Score du profil   = somme des scores de chaque jeu.
--
-- Réglages : K = 50, joueurs récents = 6 mois, plafond 3 500, 200 points de base,
-- ×2 tous les 500 Elo. La formule est la même pour tous les modes et tous les jeux.
-- =====================================================================

alter table scores add column if not exists points numeric not null default 0;
alter table scores add column if not exists equivalent_elo numeric;

-- Statistiques d'un mode : nombre de joueurs récents, seuil du top 10 % (r90),
-- et écart moyen des joueurs du top 10 % au-dessus de ce seuil (s).
create or replace function public.gs_mode_stats(p_mode_id bigint,
                                                out n integer, out r90 numeric, out s numeric)
language sql
stable
security definer set search_path = ''
as $$
  with recent as (
    select ds.rating
    from public.distribution_samples ds
    where ds.mode_id = p_mode_id
      and ds.last_played_at >= now() - interval '6 months'
  ),
  q as (
    select count(*)::integer as n,
           (percentile_cont(0.9) within group (order by rating))::numeric as r90
    from recent
  )
  select q.n, q.r90,
         (select avg(r.rating - q.r90) from recent r where r.rating > q.r90)::numeric
  from q;
$$;
revoke execute on function public.gs_mode_stats(bigint) from public, anon, authenticated;

-- Le format du résultat a changé lors d'une version précédente : on supprime d'abord.
drop function if exists public.compute_my_scores();

create function public.compute_my_scores()
returns table (game text, mode text, rating integer, percentile numeric,
               sample_size integer, equivalent_elo numeric, points numeric)
language plpgsql
security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  k             constant numeric  := 50;
  elo_cap       constant numeric  := 3500;
  base_points   constant numeric  := 200;
  elo_step      constant numeric  := 500;   -- les points doublent tous les 500 Elo
  recent_window constant interval := interval '6 months';
  me            uuid := auth.uid();
  ref_mode_id   bigint;
  ref           record;
  m             record;
  dist          record;
  snap          record;
  v_n           integer;
  v_below       integer;
  v_equal       integer;
  v_top         numeric;
  v_adj         numeric;
  v_elo         numeric;
begin
  if me is null then
    raise exception 'Il faut être connecté pour calculer son score.';
  end if;

  -- Mode de référence : Blitz Chess.com.
  select gm.id into ref_mode_id
  from public.game_modes gm
  join public.games g on g.id = gm.game_id
  where g.slug = 'chesscom' and gm.slug = 'blitz';
  select * into ref from public.gs_mode_stats(ref_mode_id);

  -- 1. Score de chaque mode, à partir du dernier rating connu.
  for snap in
    select distinct on (rs.game_account_id, rs.mode_id)
           rs.game_account_id, rs.mode_id, rs.rating, g.difficulty_factor
    from public.rating_snapshots rs
    join public.game_accounts ga on ga.id = rs.game_account_id
    join public.game_modes gm on gm.id = rs.mode_id
    join public.games g on g.id = gm.game_id
    where ga.user_id = me
    order by rs.game_account_id, rs.mode_id, rs.fetched_at desc
  loop
    -- « top » : part des joueurs qui font mieux.
    -- Mode avec répartition officielle (Lichess) : calcul direct sur tous les joueurs actifs.
    select * into dist from public.gs_dist_top(snap.mode_id, snap.rating);
    if dist.top is not null then
      v_top := dist.top;
      v_n   := dist.n;
    else
    -- Sinon : comparaison avec l'échantillon de joueurs (Chess.com, WoT).
    select * into m from public.gs_mode_stats(snap.mode_id);
    v_n := m.n;
    if m.n < 20 or m.s is null or m.s <= 0 then
      v_top := 0.5;                                        -- pas assez de données
    elsif snap.rating >= m.r90 then
      v_top := 0.10 * exp(-(snap.rating - m.r90) / m.s);   -- élite : courbe prolongée
    else
      select count(*) filter (where ds.rating < snap.rating),
             count(*) filter (where ds.rating = snap.rating)
      into v_below, v_equal
      from public.distribution_samples ds
      where ds.mode_id = snap.mode_id
        and ds.last_played_at >= now() - recent_window;
      v_top := 1 - (v_below + 0.5 * v_equal) / m.n;
    end if;
    end if;
    v_top := least(greatest(v_top, 1e-9), 1 - 1e-9);

    -- Correction de fiabilité (échelle logit).
    v_adj := 1 / (1 + exp(ln((1 - v_top) / v_top) * v_n / (v_n + k)));

    -- Elo équivalent Blitz.
    -- Mode avec table de correspondance (Lichess, voir lichess_conversion.sql) : conversion directe.
    v_elo := public.gs_convert_elo(snap.mode_id, snap.rating);
    if v_elo is not null then
      null;
    elsif snap.mode_id = ref_mode_id or ref.n < 20 or ref.s is null then
      v_elo := snap.rating;
    elsif v_adj <= 0.10 then
      v_elo := ref.r90 + ref.s * ln(0.10 / v_adj);
    else
      select (percentile_cont((1 - v_adj)::float8) within group (order by ds.rating))::numeric
      into v_elo
      from public.distribution_samples ds
      where ds.mode_id = ref_mode_id
        and ds.last_played_at >= now() - recent_window;
    end if;
    v_elo := least(v_elo, elo_cap);

    insert into public.scores (game_account_id, mode_id, percentile, sample_size,
                               adjusted_score, equivalent_elo, points, computed_at)
    values (snap.game_account_id, snap.mode_id,
            round(100 * (1 - v_top), 3), v_n, round(100 * (1 - v_adj), 3),
            round(v_elo),
            round(base_points * power(2::numeric, v_elo / elo_step) * snap.difficulty_factor),
            now())
    on conflict (game_account_id, mode_id) do update
      set percentile     = excluded.percentile,
          sample_size    = excluded.sample_size,
          adjusted_score = excluded.adjusted_score,
          equivalent_elo = excluded.equivalent_elo,
          points         = excluded.points,
          computed_at    = excluded.computed_at;
  end loop;

  -- 2. Score du profil = somme, sur chaque jeu, des meilleurs points parmi ses modes.
  insert into public.profile_scores (user_id, total_score, updated_at)
  select me, coalesce(sum(best), 0), now()
  from (
    select max(s.points) as best
    from public.scores s
    join public.game_accounts ga on ga.id = s.game_account_id
    where ga.user_id = me
    group by ga.game_id
  ) per_game
  on conflict (user_id) do update
    set total_score = excluded.total_score,
        updated_at  = excluded.updated_at;

  -- 3. On renvoie le détail pour l'afficher.
  return query
  select g.name, gm.name, l.rating, s.percentile, s.sample_size, s.equivalent_elo, s.points
  from public.scores s
  join public.game_accounts ga on ga.id = s.game_account_id
  join public.game_modes gm on gm.id = s.mode_id
  join public.games g on g.id = gm.game_id
  join lateral (
    select rs.rating from public.rating_snapshots rs
    where rs.game_account_id = s.game_account_id and rs.mode_id = s.mode_id
    order by rs.fetched_at desc limit 1
  ) l on true
  where ga.user_id = me
  order by g.name, gm.id;
end;
$$;

-- Seuls les membres connectés peuvent lancer le calcul (et seulement pour eux-mêmes).
revoke execute on function public.compute_my_scores() from public, anon;
grant execute on function public.compute_my_scores() to authenticated;

-- Lecture de ses propres scores. Personne ne peut les écrire directement :
-- seule la fonction ci-dessus le fait.
grant select on scores, profile_scores to authenticated;
drop policy if exists "scores perso : lecture" on scores;
drop policy if exists "score profil perso : lecture" on profile_scores;
create policy "scores perso : lecture" on scores
  for select to authenticated using (
    game_account_id in (select id from game_accounts where user_id = (select auth.uid()))
  );
create policy "score profil perso : lecture" on profile_scores
  for select to authenticated using (user_id = (select auth.uid()));
