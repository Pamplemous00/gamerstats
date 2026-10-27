-- =====================================================================
-- Gamer Stats — ajoute Lichess et ses 4 modes, et le calcul du « top » à partir
-- de la répartition officielle des classements publiée par Lichess.
-- À exécuter dans Supabase > SQL Editor AVANT scores.sql. Peut être relancé sans risque.
--
-- Différence avec Chess.com et WoT : pas d'échantillon de joueurs tirés au hasard.
-- Lichess publie chaque semaine le nombre de joueurs actifs par tranche de 25 points
-- (https://lichess.org/stat/rating/distribution/blitz). On stocke ces tranches dans
-- rating_distributions (rempli par lichess_distribution.py → lichess_distribution.sql).
-- =====================================================================

-- Répartition officielle : nombre de joueurs par tranche de classement.
-- Tranche « bucket_min » = joueurs entre bucket_min et bucket_min + 25.
-- La première tranche contient aussi tous les joueurs en dessous, la dernière tous ceux au-dessus.
create table if not exists rating_distributions (
  mode_id    bigint  not null references game_modes (id) on delete cascade,
  bucket_min integer not null,
  players    integer not null check (players >= 0),
  updated_at timestamptz not null default now(),
  primary key (mode_id, bucket_min)
);
-- RLS sans règle : personne ne lit ni n'écrit directement (seules les fonctions du site le lisent,
-- et seul le SQL Editor écrit dedans).
alter table rating_distributions enable row level security;

insert into games (slug, name)
values ('lichess', 'Lichess')
on conflict (slug) do nothing;

insert into game_modes (game_id, slug, name, api_key)
select g.id, m.slug, m.name, m.api_key
from games g
cross join (values
  ('bullet',    'Bullet',    'bullet'),
  ('blitz',     'Blitz',     'blitz'),
  ('rapid',     'Rapid',     'rapid'),
  ('classical', 'Classical', 'classical')
) as m (slug, name, api_key)
where g.slug = 'lichess'
on conflict (game_id, slug) do nothing;

-- « top » d'un classement (part des joueurs qui font mieux) d'après la répartition officielle.
-- Renvoie top = null si le mode n'a pas de répartition (Chess.com, WoT : échantillon classique).
--   - dans une tranche, on suppose les joueurs répartis uniformément ;
--   - au-dessus de la dernière tranche (ex. 2 800+ sur Lichess), on prolonge la courbe :
--     le nombre de joueurs est divisé par e tous les `s` points, avec s mesuré sur les
--     tranches juste en dessous (décroissance entre [dernière − 200, dernière − 100[ et
--     [dernière − 100, dernière[).
create or replace function public.gs_dist_top(p_mode_id bigint, p_rating numeric,
                                              out top numeric, out n integer)
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  step    constant numeric := 25;
  v_total numeric;
  v_first integer;
  v_last  integer;
  v_bmin  integer;
  v_in    numeric;
  v_above numeric;
  v_a     numeric;
  v_b     numeric;
  v_s     numeric := 100;   -- valeur de secours si la décroissance n'est pas mesurable
begin
  select sum(d.players), min(d.bucket_min), max(d.bucket_min)
  into v_total, v_first, v_last
  from public.rating_distributions d
  where d.mode_id = p_mode_id;

  if v_total is null or v_total < 20 then
    return;  -- pas de répartition : top et n restent null
  end if;
  n := v_total::integer;

  if p_rating >= v_last then
    select d.players into v_in from public.rating_distributions d
    where d.mode_id = p_mode_id and d.bucket_min = v_last;
    select sum(d.players) filter (where d.bucket_min >= v_last - 200 and d.bucket_min < v_last - 100),
           sum(d.players) filter (where d.bucket_min >= v_last - 100 and d.bucket_min < v_last)
    into v_a, v_b
    from public.rating_distributions d
    where d.mode_id = p_mode_id;
    if v_a > v_b and v_b > 0 then
      v_s := 100 / ln(v_a / v_b);
    end if;
    top := (v_in / v_total) * exp(-(p_rating - v_last) / v_s);
    return;
  end if;

  -- Tranche du joueur (ou la première s'il est en dessous).
  v_bmin := greatest(v_first, (v_first + floor((p_rating - v_first) / step) * step)::integer);
  select coalesce(sum(d.players) filter (where d.bucket_min > v_bmin), 0),
         coalesce(sum(d.players) filter (where d.bucket_min = v_bmin), 0)
  into v_above, v_in
  from public.rating_distributions d
  where d.mode_id = p_mode_id;

  top := (v_above + v_in * least(1, greatest(0, (v_bmin + step - p_rating) / step))) / v_total;
end;
$$;
revoke execute on function public.gs_dist_top(bigint, numeric) from public, anon, authenticated;
