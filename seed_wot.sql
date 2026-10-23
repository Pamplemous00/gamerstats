-- =====================================================================
-- Gamer Stats — ajoute World of Tanks (serveur Europe) et son mode « WN8 ».
-- À exécuter dans Supabase > SQL Editor. Peut être relancé sans risque.
--
-- Un seul « mode » : le WN8 global en batailles aléatoires, calculé par le site
-- (stats Wargaming char par char + valeurs attendues XVM).
-- Le score suit la même formule que Chess.com (compute_my_scores) :
-- percentile du WN8 parmi les joueurs récents → Elo équivalent Blitz → points.
-- =====================================================================

insert into games (slug, name)
values ('wot', 'World of Tanks')
on conflict (slug) do nothing;

insert into game_modes (game_id, slug, name, api_key)
select g.id, 'wn8', 'WN8', 'wn8'
from games g
where g.slug = 'wot'
on conflict (game_id, slug) do nothing;
