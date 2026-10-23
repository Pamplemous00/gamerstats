-- =====================================================================
-- Gamer Stats — schéma de la base (MVP Chess.com)
-- À coller dans Supabase > SQL Editor, puis cliquer sur "Run".
-- Ensuite, exécuter seed_chess_modes.sql.
-- =====================================================================

-- Profils des utilisateurs du site.
-- L'id est celui du compte créé par Supabase Auth (connexion email, etc.).
create table if not exists users (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Les jeux pris en charge (Chess.com, plus tard osu!, Dota 2...).
-- difficulty_factor : à quel point le jeu est compétitif (1 = référence).
create table if not exists games (
  id                bigint generated always as identity primary key,
  slug              text not null unique,          -- ex. 'chesscom'
  name              text not null,                 -- ex. 'Chess.com'
  difficulty_factor numeric not null default 1,
  created_at        timestamptz not null default now()
);

-- Les modes de chaque jeu (Bullet, Blitz, Rapid, Daily pour Chess.com).
-- api_key : nom du mode dans la réponse de l'API (ex. 'chess_blitz').
create table if not exists game_modes (
  id      bigint generated always as identity primary key,
  game_id bigint not null references games (id) on delete cascade,
  slug    text not null,                           -- ex. 'blitz'
  name    text not null,                           -- ex. 'Blitz'
  api_key text not null,
  unique (game_id, slug)
);

-- Lien entre un utilisateur du site et son pseudo dans un jeu.
-- verified : prévu pour plus tard (preuve que le pseudo appartient bien à l'utilisateur).
create table if not exists game_accounts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references users (id) on delete cascade,
  game_id    bigint not null references games (id) on delete cascade,
  username   text not null,
  verified   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, game_id)
);

-- Historique des ratings d'un compte lié, mode par mode.
create table if not exists rating_snapshots (
  id              bigint generated always as identity primary key,
  game_account_id bigint not null references game_accounts (id) on delete cascade,
  mode_id         bigint not null references game_modes (id) on delete cascade,
  rating          integer not null,
  games_played    integer,
  last_played_at  timestamptz,
  fetched_at      timestamptz not null default now()
);

-- Échantillons servant à construire la distribution des ratings de chaque mode.
-- Pas de pseudo en clair : player_hash est une empreinte (SHA-256) du pseudo.
-- Un seul échantillon par joueur et par mode (mis à jour à chaque recherche).
create table if not exists distribution_samples (
  id             bigint generated always as identity primary key,
  mode_id        bigint not null references game_modes (id) on delete cascade,
  player_hash    text not null,
  rating         integer not null,
  games_played   integer,
  last_played_at timestamptz,                      -- pour ne garder que les joueurs récents
  collected_at   timestamptz not null default now(),
  unique (mode_id, player_hash)
);

-- Score calculé pour un compte dans un mode (percentile + correction de fiabilité).
create table if not exists scores (
  id              bigint generated always as identity primary key,
  game_account_id bigint not null references game_accounts (id) on delete cascade,
  mode_id         bigint not null references game_modes (id) on delete cascade,
  percentile      numeric not null,                -- entre 0 et 100
  sample_size     integer not null,                -- nb de joueurs dans la distribution
  adjusted_score  numeric not null,
  computed_at     timestamptz not null default now(),
  unique (game_account_id, mode_id)
);

-- Score total du profil (somme des scores de référence de chaque jeu).
create table if not exists profile_scores (
  user_id     uuid primary key references users (id) on delete cascade,
  total_score numeric not null default 0,
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- Sécurité (Row Level Security)
-- Par défaut, personne ne peut lire ni écrire. On ouvre seulement ce qui
-- est nécessaire au script chess_fetch.py (clé publishable = rôle "anon").
-- Les règles pour les comptes utilisateurs seront ajoutées plus tard.
-- =====================================================================
alter table users                enable row level security;
alter table games                enable row level security;
alter table game_modes           enable row level security;
alter table game_accounts        enable row level security;
alter table rating_snapshots     enable row level security;
alter table distribution_samples enable row level security;
alter table scores               enable row level security;
alter table profile_scores       enable row level security;

-- Tout le monde peut lire la liste des jeux et des modes.
grant select on games, game_modes to anon, authenticated;
create policy "lecture publique des jeux" on games
  for select to anon, authenticated using (true);
create policy "lecture publique des modes" on game_modes
  for select to anon, authenticated using (true);

-- Le script peut ajouter / mettre à jour les échantillons anonymisés.
grant select, insert, update on distribution_samples to anon, authenticated;
create policy "lecture des échantillons" on distribution_samples
  for select to anon, authenticated using (true);
create policy "ajout d'échantillons" on distribution_samples
  for insert to anon, authenticated with check (true);
create policy "mise à jour d'échantillons" on distribution_samples
  for update to anon, authenticated using (true) with check (true);
