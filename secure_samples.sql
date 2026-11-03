-- =====================================================================
-- Gamer Stats — ferme l'accès public aux échantillons de joueurs (03/11/2026).
-- À exécuter dans Supabase > SQL Editor. Peut être relancé sans risque.
--
-- Avant : la clé publique du site (visible par tous) pouvait lire, ajouter et modifier
-- distribution_samples → n'importe qui pouvait ajouter de faux joueurs et fausser les Top %.
-- Après : seule la clé secrète (service_role) y a accès :
--   - la mise à jour du lundi (nightly_refresh.py) met à jour les échantillons des membres ;
--   - les scripts de remplissage tournent sur GitHub Actions (seed.yml).
-- Le calcul des scores n'est pas touché : ses fonctions lisent la table avec les droits du serveur.
-- =====================================================================

drop policy if exists "lecture des échantillons" on distribution_samples;
drop policy if exists "ajout d'échantillons" on distribution_samples;
drop policy if exists "mise à jour d'échantillons" on distribution_samples;

revoke all on distribution_samples from anon, authenticated;
alter table distribution_samples enable row level security;  -- RLS sans règle = aucun accès public
