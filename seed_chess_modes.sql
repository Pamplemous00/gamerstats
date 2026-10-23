-- =====================================================================
-- Gamer Stats — données de départ : le jeu Chess.com et ses 3 modes
-- (Daily retiré volontairement : mode par correspondance, peu joué).
-- À exécuter dans Supabase > SQL Editor APRÈS schema_chess_mvp.sql.
-- Peut être relancé sans risque (pas de doublons).
-- =====================================================================

insert into games (slug, name)
values ('chesscom', 'Chess.com')
on conflict (slug) do nothing;

insert into game_modes (game_id, slug, name, api_key)
select g.id, m.slug, m.name, m.api_key
from games g
cross join (values
  ('bullet', 'Bullet', 'chess_bullet'),
  ('blitz',  'Blitz',  'chess_blitz'),
  ('rapid',  'Rapid',  'chess_rapid')
) as m (slug, name, api_key)
where g.slug = 'chesscom'
on conflict (game_id, slug) do nothing;
