-- =====================================================================
-- Gamer Stats — retire le mode Daily de Chess.com.
-- Supprime aussi tout ce qui s'y rattache (échantillons, historique, scores).
-- Peut être relancé sans risque.
-- =====================================================================

delete from game_modes
where slug = 'daily'
  and game_id = (select id from games where slug = 'chesscom');
