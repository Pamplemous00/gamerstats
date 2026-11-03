-- =====================================================================
-- Gamer Stats — classement.
-- À exécuter dans Supabase > SQL Editor APRÈS scores.sql.
-- Peut être relancé sans risque.
--
-- get_leaderboard(p_games) renvoie le top 10, plus la ligne du membre connecté
-- s'il est en dehors du top 10.
--   - p_games vide ou absent : classement global (score total du profil) ;
--   - p_games = liste de jeux (ex. {chesscom,lichess}) : seulement les joueurs qui ont
--     TOUS ces jeux, classés sur la somme de leurs points dans ces jeux.
-- Chaque ligne donne aussi les jeux du joueur (slugs), du meilleur au moins bon.
-- Accessible à tous (même sans être connecté). N'expose ni email ni identifiant :
-- seulement le pseudo (ou « Joueur XXXX » si le membre n'en a pas choisi).
-- =====================================================================

drop function if exists public.get_leaderboard();
drop function if exists public.get_leaderboard(text[]);

create function public.get_leaderboard(p_games text[] default null)
returns table (place bigint, display_name text, total_score numeric, games text[],
               is_me boolean, total_players bigint)
language sql
stable
security definer set search_path = ''
as $$
  with wanted as (
    select distinct unnest(coalesce(p_games, '{}')) as slug
  ),
  -- Points de chaque joueur dans chaque jeu (meilleur mode).
  per_game as (
    select ga.user_id, g.slug, max(s.points) as pts
    from public.scores s
    join public.game_accounts ga on ga.id = s.game_account_id
    join public.games g on g.id = ga.game_id
    group by ga.user_id, g.slug
  ),
  per_user as (
    select pg.user_id,
           array_agg(pg.slug order by pg.pts desc) as games,
           sum(pg.pts) filter (where pg.slug in (select slug from wanted)) as wanted_pts,
           count(*)    filter (where pg.slug in (select slug from wanted)) as wanted_count
    from per_game pg
    group by pg.user_id
  ),
  base as (
    select pu.user_id, pu.games,
           case when (select count(*) from wanted) = 0 then ps.total_score else pu.wanted_pts end as score
    from per_user pu
    join public.profile_scores ps on ps.user_id = pu.user_id
    where (select count(*) from wanted) = 0
       or pu.wanted_count = (select count(*) from wanted)
  ),
  ranked as (
    select b.user_id,
           coalesce(nullif(trim(u.display_name), ''),
                    'Joueur ' || upper(left(md5(b.user_id::text), 4))) as name,
           b.score, b.games,
           rank() over (order by b.score desc) as pos,
           count(*) over () as n
    from base b
    join public.users u on u.id = b.user_id
    where b.score > 0
  )
  select pos, name, score, games, coalesce(user_id = auth.uid(), false), n
  from ranked
  where pos <= 10 or user_id = auth.uid()
  order by pos, name;
$$;

grant execute on function public.get_leaderboard(text[]) to anon, authenticated;
