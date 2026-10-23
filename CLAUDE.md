# Gamer Stats — contexte du projet

## À propos de l'utilisateur
- Débutant en développement web et en gestion de projet : expliquer simplement, étape par étape, sans jargon inutile.
- Système : Windows (terminal : PowerShell ou Git Bash). Langue : français.

## Objectif
Site web qui centralise les statistiques de joueurs sur plusieurs jeux :
- Menu déroulant des jeux ; l'utilisateur entre son pseudo pour un jeu et récupère ses stats.
- Comptes utilisateurs pour sauvegarder les informations.
- Leaderboard global à droite de la page d'accueil (points et pourcentage).
- Pour chaque jeu : un score tenant compte du percentile ET de la difficulté d'atteindre ce niveau (un bon percentile est plus facile à atteindre sur un jeu casual que sur un jeu très compétitif).
- Page d'accueil : score total du profil = somme des scores de chaque jeu.

## Jeux
- MVP : **Chess.com** uniquement (API publique, sans clé : `https://api.chess.com/pub/player/{pseudo}/stats`).
- Ensuite : osu! (API v2 officielle), puis Dota 2 (OpenDota), WoW (Battle.net), CS2 (Steam).
- LoL et Valorant : plus tard, nécessitent une clé de production Riot (demande à faire quand le projet sera concret).

## Décisions de conception
- **Score (décidé le 19/10/2026, remplace l'ancien score « percentile × 10 »)** : la difficulté de progresser est exponentielle avec l'Elo, donc les points sont basés sur l'Elo et non sur un pourcentage.
  - Monnaie commune du site : **Elo équivalent Blitz Chess.com**. Blitz Chess.com = Elo brut. Autres modes (Rapid, Bullet) et autres jeux (WN8…) : on estime le « top » du joueur (part des joueurs qui font mieux), puis on prend l'Elo Blitz qui a le même top. Ça corrige aussi le fait que l'Elo Rapid est naturellement plus haut que l'Elo Blitz.
  - **Version du 23/10/2026** (remplace la version « percentile + shrinkage linéaire », qui plafonnait l'élite des autres jeux vers ~1 800 Elo équivalent / ~2 400 pts) :
    - jusqu'au top 10 % : top empirique dans l'échantillon ;
    - au-delà : **queue exponentielle** `top = 10 % × exp(−(rating − r90) / s)`, r90 = seuil du top 10 %, s = écart moyen du top 10 % au-dessus de r90 (fonction SQL `gs_mode_stats`) ; même modèle côté Blitz pour la conversion inverse ;
    - correction de fiabilité sur l'échelle logit : `logit(top ajusté) = logit(top) × n / (n + 50)` ;
    - **plafond à 3 500 Elo équivalent** (≈ n°1 mondial des échecs, ≈ 25 600 pts par jeu), validé par l'utilisateur.
    - Résultats de référence : WN8 4 000 (top 0,1 %) ≈ 2 950 Elo éq. / ~12 000 pts ; Hikaru cohérent entre ses modes (Bullet 3 420 → ~3 300, Rapid 2 838 → ~3 200, Blitz 3 470).
    - ⚠️ **Modèle imparfait, à revoir plus tard (demande de l'utilisateur)** : la queue exponentielle est une approximation (estimée sur ~100 joueurs du top 10 % de chaque échantillon), sensible à la taille et au biais des échantillons, et le plafond est arbitraire. Pistes : échantillons plus grands, autre forme de queue, ancrages externes (classements officiels), `difficulty_factor` par jeu.
  - **Points = 200 × 2^(Elo équivalent / 500) × `difficulty_factor`** : les points doublent tous les 500 Elo. Compromis voulu par l'utilisateur entre linéaire (pas assez de récompense pour l'élite) et ×10 tous les 500 Elo (un seul jeu écrase tout). Objectif d'équilibrage : un spécialiste de très haut niveau (ex. Hikaru, ~11 000 pts) reste devant un joueur « ok » dans plusieurs jeux, mais jouer à plusieurs jeux reste intéressant. Le « ×2 » est le réglage à modifier si l'équilibrage ne plaît pas.
  - **Même formule pour tous les modes et tous les jeux.**
- **Score de référence d'un jeu** = meilleurs points parmi ses modes (Bullet, Blitz, Rapid pour Chess.com). Le mode Daily (par correspondance) a été retiré volontairement : peu joué, peu utile pour comparer.
- **Joueurs récents uniquement** pour construire les distributions : 6 mois.
- **Distribution** : l'API Chess.com ne fournit pas la distribution complète ; on la construit avec des joueurs européens tirés au hasard (`seed_distribution.py`) + les pseudos recherchés (table `distribution_samples`, anonymisée). WoT : 1 002 joueurs EU actifs (`seed_wot_distribution.py`, terminé le 23/10/2026).
- **Vérification de pseudo** : association simple, non vérifiée au départ (champ `verified` prêt pour plus tard).
- **RGPD** : politique de confidentialité minimale dès le début (page statique). Utilisateur basé en France.

## Stack
- Base de données : Supabase (PostgreSQL hébergé). Clés dans `.env` (jamais dans le code ni sur Git), sauf la clé **publishable** qui est aussi dans `site/js/config.js` : elle est faite pour être publique, la sécurité vient du RLS.
- **Site web (décidé le 19/10/2026)** : site statique HTML/CSS/JavaScript dans `site/`, sans serveur. Le navigateur parle directement à Supabase (auth, tables, RPC `compute_my_scores`) et à l'API Chess.com (CORS autorisé). supabase-js chargé depuis jsDelivr (`@supabase/supabase-js@2.45.4`). Hébergement prévu gratuit (GitHub Pages / Netlify / Vercel).
- Scripts Python en coulisses (remplissage de la distribution, tests).
- Aperçu local : `.claude/launch.json` (config « site ») lance `python -m http.server 8000` sur le dossier `site/` → http://localhost:8000.
- Suivi de projet prévu : GitHub Projects (Kanban) + ce fichier pour les décisions.

## Fichiers existants
- `schema_chess_mvp.sql` : schéma (users, games, game_modes, game_accounts, rating_snapshots, distribution_samples, scores, profile_scores).
- `seed_chess_modes.sql` : insère le jeu Chess.com et ses 3 modes. À exécuter après le schéma.
- `remove_daily.sql` : supprime le mode Daily (et ses échantillons, historique, scores) d'une base créée avant son retrait.
- `accounts_rls.sql` : crée la fiche `users` à l'inscription (trigger sur `auth.users`) + règles RLS « chacun ne voit que ses données » pour `users`, `game_accounts`, `rating_snapshots`. À exécuter après le seed.
- `link_account.py` : `python link_account.py <pseudo>` se connecte avec le compte de test (`TEST_EMAIL` / `TEST_PASSWORD` du `.env`), lie le pseudo (`game_accounts`), ajoute les ratings à `rating_snapshots` et à `distribution_samples`. Réutilise les fonctions de `chess_fetch.py`.
- `seed_distribution.py` : `python seed_distribution.py [--target 1000] [--max-requests 6000]` tire au hasard des joueurs **européens** (listes par pays de Chess.com) pour remplir `distribution_samples`, jusqu'à `target` joueurs récents par mode. Limite connue : pour les grands pays, l'API ne renvoie que les 10 000 premiers pseudos par ordre alphabétique (chiffres et début du « a »), petit biais accepté pour le MVP.
- `scores.sql` : fonction `compute_my_scores()` (appelée par un membre connecté, calcule et enregistre ses `scores` et son `profile_scores`). Les membres ne peuvent pas écrire leurs scores directement. Formule : voir « Décisions de conception » (Elo équivalent Blitz, points ×2 tous les 500 Elo).
- `leaderboard.sql` : fonction publique `get_leaderboard()` (anon + connectés) : top 10 par `profile_scores.total_score` + la ligne du membre connecté s'il est hors top 10, avec le nombre total de classés. N'expose que le nom affiché (ou « Joueur XXXX », dérivé d'un md5 de l'id). Limite : `profile_scores` n'est mis à jour que quand le membre recalcule son score (ouverture du profil / Actualiser).
- `seed_wot.sql` : ajoute le jeu World of Tanks (`wot`) et son mode `wn8`.
- `wot.py` : `python wot.py <pseudo>` recherche le joueur (serveur EU) et calcule son WN8 ; fonctions réutilisées par `seed_wot_distribution.py`.
- `seed_wot_distribution.py` : `python seed_wot_distribution.py [--target 1000]` remplit la distribution WN8 avec des joueurs EU actifs tirés au hasard.
- `reset_schema.sql` : supprime toutes les tables et leurs données (pour repartir de zéro uniquement).
- `chess_fetch.py` : `python chess_fetch.py <pseudo>` récupère les ratings via l'API Chess.com et les ajoute à `distribution_samples` (un échantillon par joueur et par mode, identifié par un hash SHA-256 du pseudo, mis à jour à chaque recherche).
- `.env` (à créer, ne pas versionner) :
  ```
  SUPABASE_URL=https://<ref-projet>.supabase.co
  SUPABASE_KEY=<clé "Publishable key", commence par sb_publishable_ (remplace l'ancienne clé anon eyJ...)>
  TEST_EMAIL=<email du compte de test créé dans Supabase > Authentication>
  TEST_PASSWORD=<mot de passe de ce compte de test>
  ```
- `site/` : le site web.
  - `index.html` (accueil + emplacement du leaderboard), `connexion.html` (connexion / inscription), `profil.html` : écran épuré, fond noir. Bandeau en haut = logo GamerStats + nom du profil + score total + déconnexion. En dessous, une grille de cartes (une par jeu, seulement Chess.com pour l'instant) : icône du jeu dans un cercle, points du meilleur mode en gros, pastille « Top x % » en dégradé continu rouge (Top 100 %) → orange → jaune → vert → bleu → violet (Top 0,1 %), échelle logarithmique (fonction `pillColor`), meilleur mode + Elo. Clic sur la carte = fenêtre `<dialog>` plus claire, au premier plan, avec le fond flouté (détail par mode + formulaire du pseudo ; fermeture par ×, Échap ou clic sur le fond). Icône Chess.com = pion SVG maison sur fond vert, pas le logo officiel), `confidentialite.html` (RGPD : email de contact public `gamerstats.contact@gmail.com`, adresse dédiée au projet).
  - Pas de pied de page : la politique de confidentialité est dans le menu qui s'ouvre en cliquant sur « GamerStats » (Accueil, Mon profil, Politique de confidentialité ; `setupBrandMenu()` dans `js/supabase.js`, remplit `[data-brand]`).
  - Classement (`js/leaderboard.js`) à droite sur l'accueil et sur le profil.
  - `css/style.css` (thème noir uniquement, choix de l'utilisateur), `js/config.js` (URL + clé publishable + `WG_APPLICATION_ID`), `js/supabase.js` (client partagé, menu, `getLinkedUsername(userId, slug)`, `computeScores()`), `js/chess.js` et `js/wot.js` (chacun exporte `linkAndRefresh(userId, pseudo)`).
  - `js/games.js` : **liste des jeux** (slug, nom identique à `games.name`, couleur et icône SVG du cercle, libellé de la note, texte d'aide, module). `profil.html` fabrique automatiquement une carte + une fenêtre de détail par jeu. Pour ajouter un jeu : une entrée dans `GAMES` + un module `js/<jeu>.js`.
- `.gitignore` : `.env`, `__pycache__/`, `*.pyc`, `*_log.txt`, `.claude/settings.local.json`.
- `.github/workflows/pages.yml` : publie automatiquement le dossier `site/` sur GitHub Pages à chaque push sur `main`.

## En ligne (23/10/2026)
- Dépôt GitHub **public** : https://github.com/Pamplemous00/gamerstats (branche `main`). Ne jamais y mettre `.env` ni de clé secrète ; vérifier avant chaque commit.
- Site : https://pamplemous00.github.io/gamerstats/ (GitHub Pages, source « GitHub Actions »).
- Pour mettre à jour le site en ligne : commit + push sur `main`.

## Où en est-on
Fait (19/10/2026) : Python 3.15 installé avec les dépendances, `.env` configuré, schéma et seed exécutés dans Supabase, `chess_fetch.py` testé avec succès (`hikaru` : 4 échantillons enregistrés, pas de doublon à la relance).
Les anciennes requêtes « Seed » et « Schema » enregistrées dans le SQL Editor de Supabase sont obsolètes : ne plus les utiliser.

Fait (19/10/2026) : comptes + liaison pseudo. `accounts_rls.sql` exécuté, compte de test créé, `link_account.py Pamplemous00` testé avec succès (pseudo Chess.com de l'utilisateur). Vérifié : un visiteur non connecté ne voit ni `game_accounts` ni `rating_snapshots`.

Fait (19/10/2026) : calcul du score. `remove_daily.sql` et `scores.sql` exécutés, `link_account.py` affiche maintenant les scores (premier test avec l'ancienne formule percentile : 815 points ; formule remplacée ensuite par l'Elo équivalent). Remplissage de la distribution (`seed_distribution.py`, cible 1 000 joueurs récents par mode) lancé, à relancer s'il a été interrompu.

Fait (19/10/2026) : première version du site (`site/`), pages affichées sans erreur dans l'aperçu local. Connexion + page profil restent à tester par l'utilisateur (Claude ne saisit pas d'identifiants dans le navigateur).

Fait (20/10/2026) : remplissage Chess.com terminé — Bullet 1 000, Blitz ~1 540, Rapid ~2 075 joueurs européens récents. `seed_distribution.py` réessaie maintenant en cas de coupure réseau vers Supabase. Le relancer de temps en temps garde la distribution à jour (les doublons sont mis à jour, pas dupliqués).

**2e jeu (23/10/2026) : World of Tanks, serveur Europe, note = WN8 calculé par nous-mêmes.** Tomato.gg abandonné : la clé API n'est pas accessible depuis le compte gratuit de l'utilisateur (sans doute réservée aux abonnés).
- Pseudo → account ID : API officielle Wargaming (`account/list`, `type=exact`). `WG_APPLICATION_ID` (application de type « Mobile », pas « Server ») dans `.env` ET dans `site/js/config.js` : ce n'est pas un secret. L'API Wargaming autorise les appels depuis le navigateur (CORS `*`) → pas d'Edge Function.
- WN8 = formule officielle, calculée sur les stats char par char en batailles aléatoires (`tanks/stats` avec `extra=random`) + valeurs attendues XVM (https://static.modxvm.com/wn8-data-exp/json/wg/wn8exp.json, CORS `*`, lu directement par le site). Validé : 1 821 pour Pamplemousse00, identique à Tomato.gg. Minimum 100 batailles aléatoires.
- Compte WoT de l'utilisateur : **Pamplemousse00** (account_id 527360349).
- Un seul mode « WN8 » ; le score passe par la même `compute_my_scores()` (percentile du WN8 → Elo équivalent Blitz → points). `difficulty_factor` = 1 pour l'instant.
- Distribution : `seed_wot_distribution.py`, tirage aléatoire d'account IDs EU (500 M–620 M, ~2 % sont des joueurs actifs), hash `sha256("wot:{account_id}")`.

## Prochaines étapes
1. Finaliser le site : prévoir la suppression de compte (promise dans la politique de confidentialité). Fait (23/10/2026) : email de contact RGPD, mise en ligne, vraie inscription testée en ligne par l'utilisateur (OK), Supabase > Authentication > URL Configuration réglé (Site URL = https://pamplemous00.github.io/gamerstats/, Redirect URLs = cette adresse + `/**` et `http://localhost:8000/**`).
2. World of Tanks : tester la carte sur le site (l'utilisateur se connecte), choisir le `difficulty_factor`. Ensuite osu! (nécessitera une Edge Function, clé secrète).

Fait (19/10/2026) : classement global (top 10 + position perso), menu GamerStats avec la confidentialité, pieds de page retirés.

## Idées pour plus tard
- **WN8 récent (1 000 dernières batailles), comme Tomato.gg** : l'API Wargaming ne donne que des totaux cumulés. Il faudrait enregistrer des « photos » char par char à intervalles réguliers (tâche planifiée côté Supabase, ex. chaque nuit) et calculer le WN8 sur la différence. Ne marche qu'à partir du début des photos. Affichage à titre d'information dans la fenêtre de détail ; le score reste sur le WN8 global.
- Ne pas récupérer les données de Tomato.gg en lisant leur site automatiquement (« scraping ») : contraire à l'esprit de leur API payante, fragile et bloqué par le navigateur. Si besoin de leurs données : leur écrire pour demander un accès à l'API, ou prendre l'abonnement.
- **Contacter Tomato.gg (décidé le 23/10/2026)** quand le site sera plus développé (en ligne, avec des utilisateurs) : présenter le projet et demander un accès à leur API (WN8 récent notamment). Ils ont un Discord.

## Points d'attention
- Ne jamais afficher ni committer les clés Supabase. Utiliser la clé publishable (ou l'ancienne anon), jamais la secret / service_role.
- Garder la formule de score identique entre les modes d'un même jeu.
- RLS activé sur toutes les tables. Provisoire (MVP) : la clé publishable peut lire/écrire `distribution_samples`, donc n'importe qui pourrait y ajouter de fausses données. À terme, faire les écritures côté serveur avec la clé secrète.
