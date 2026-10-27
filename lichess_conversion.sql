-- =====================================================================
-- Gamer Stats — rééquilibrage de Lichess (27/10/2026).
-- À exécuter dans Supabase > SQL Editor APRÈS seed_lichess.sql et AVANT scores.sql.
-- Peut être relancé sans risque.
--
-- Problème : convertir par le Top % sous-évaluait Lichess (Blitz 1 744 → 917 Elo équivalent),
-- car la répartition Lichess ne compte que les joueurs actifs de la semaine (population
-- plus forte) alors que l'échantillon Chess.com contient beaucoup de joueurs occasionnels.
--
-- Solution : table de correspondance publiée par ChessGoals (https://chessgoals.com/rating-comparison/,
-- mise à jour de juillet 2026, joueurs actifs sur les deux sites, RD < 150) :
-- Elo Lichess d'un mode → Elo Blitz Chess.com (la monnaie commune du site).
-- Entre deux lignes : interpolation linéaire ; au-delà : on prolonge le segment le plus proche.
-- Le Top % affiché reste celui des joueurs Lichess (rating_distributions).
-- =====================================================================

create table if not exists rating_conversions (
  mode_id     bigint  not null references game_modes (id) on delete cascade,
  from_rating integer not null,   -- Elo dans le mode (ex. Lichess Blitz)
  to_elo      integer not null,   -- Elo Blitz Chess.com équivalent
  primary key (mode_id, from_rating)
);
alter table rating_conversions enable row level security;  -- lu uniquement par les fonctions

-- Table ChessGoals : Elo Blitz Chess.com, puis Lichess Blitz, Bullet, Rapid, Classical.
with cg (chesscom, li_blitz, li_bullet, li_rapid, li_classical) as (values
  ( 500, 1090, 1060, 1290, 1505), ( 600, 1160, 1120, 1360, 1540), ( 700, 1225, 1180, 1425, 1575),
  ( 800, 1290, 1240, 1490, 1610), ( 900, 1360, 1305, 1555, 1650), (1000, 1425, 1375, 1615, 1690),
  (1100, 1490, 1445, 1680, 1730), (1150, 1525, 1480, 1710, 1750), (1200, 1555, 1515, 1740, 1770),
  (1250, 1590, 1550, 1765, 1795), (1300, 1620, 1585, 1795, 1815), (1350, 1655, 1625, 1825, 1835),
  (1400, 1685, 1660, 1850, 1860), (1450, 1720, 1700, 1880, 1880), (1500, 1755, 1735, 1905, 1900),
  (1550, 1785, 1775, 1935, 1925), (1600, 1820, 1815, 1960, 1945), (1650, 1850, 1855, 1990, 1970),
  (1700, 1885, 1890, 2015, 1990), (1750, 1915, 1930, 2040, 2015), (1800, 1950, 1970, 2065, 2035),
  (1850, 1980, 2010, 2090, 2055), (1900, 2015, 2050, 2115, 2080), (1950, 2045, 2095, 2140, 2100),
  (2000, 2080, 2135, 2165, 2120), (2100, 2145, 2215, 2215, 2165), (2200, 2210, 2300, 2260, 2205),
  (2300, 2275, 2380, 2310, 2245), (2400, 2340, 2465, 2355, 2280), (2500, 2410, 2550, 2400, 2320),
  (2600, 2475, 2635, 2445, 2350), (2700, 2540, 2715, 2490, 2385), (2800, 2610, 2800, 2530, 2415),
  (2900, 2675, 2885, 2575, 2440), (3000, 2745, 2970, 2615, 2465)
),
rows as (
  select 'blitz' as mode, li_blitz as from_rating, chesscom as to_elo from cg
  union all select 'bullet', li_bullet, chesscom from cg
  union all select 'rapid', li_rapid, chesscom from cg
  union all select 'classical', li_classical, chesscom from cg
)
insert into rating_conversions (mode_id, from_rating, to_elo)
select gm.id, r.from_rating, r.to_elo
from rows r
join game_modes gm on gm.slug = r.mode
join games g on g.id = gm.game_id and g.slug = 'lichess'
on conflict (mode_id, from_rating) do update set to_elo = excluded.to_elo;

-- Elo Blitz Chess.com équivalent d'un classement, ou null si le mode n'a pas de table.
create or replace function public.gs_convert_elo(p_mode_id bigint, p_rating numeric)
returns numeric
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  lo record;
  hi record;
begin
  -- Les deux points qui encadrent le classement.
  select c.from_rating, c.to_elo into lo from public.rating_conversions c
  where c.mode_id = p_mode_id and c.from_rating <= p_rating
  order by c.from_rating desc limit 1;
  select c.from_rating, c.to_elo into hi from public.rating_conversions c
  where c.mode_id = p_mode_id and c.from_rating > p_rating
  order by c.from_rating limit 1;

  -- En dehors de la table : on prend le segment le plus proche et on le prolonge.
  if lo.from_rating is null and hi.from_rating is null then
    return null;  -- pas de table pour ce mode
  elsif lo.from_rating is null then
    lo := hi;
    select c.from_rating, c.to_elo into hi from public.rating_conversions c
    where c.mode_id = p_mode_id and c.from_rating > lo.from_rating
    order by c.from_rating limit 1;
  elsif hi.from_rating is null then
    hi := lo;
    select c.from_rating, c.to_elo into lo from public.rating_conversions c
    where c.mode_id = p_mode_id and c.from_rating < hi.from_rating
    order by c.from_rating desc limit 1;
  end if;

  return lo.to_elo + (p_rating - lo.from_rating) * (hi.to_elo - lo.to_elo)::numeric
                   / (hi.from_rating - lo.from_rating);
end;
$$;
revoke execute on function public.gs_convert_elo(bigint, numeric) from public, anon, authenticated;
