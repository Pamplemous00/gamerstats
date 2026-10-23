-- =====================================================================
-- Gamer Stats — ATTENTION : supprime toutes les tables du projet ET leurs données.
-- À n'utiliser que pour repartir de zéro (ex. : ancienne version du schéma).
-- Ordre ensuite : schema_chess_mvp.sql, puis seed_chess_modes.sql.
-- =====================================================================

drop table if exists profile_scores       cascade;
drop table if exists scores               cascade;
drop table if exists distribution_samples cascade;
drop table if exists rating_snapshots     cascade;
drop table if exists game_accounts        cascade;
drop table if exists game_modes           cascade;
drop table if exists games                cascade;
drop table if exists users                cascade;
