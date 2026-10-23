-- =====================================================================
-- Gamer Stats — suppression de compte (RGPD).
-- À exécuter dans Supabase > SQL Editor. Peut être relancé sans risque.
--
-- delete_my_account() supprime le compte du membre connecté dans Supabase Auth.
-- Grâce aux « on delete cascade » du schéma, cela supprime aussi :
-- sa fiche users, ses pseudos liés (game_accounts), son historique de ratings
-- (rating_snapshots), ses scores (scores) et son score total (profile_scores).
-- Les échantillons anonymisés (distribution_samples) ne sont pas liés au compte
-- et restent pour les statistiques.
-- =====================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Il faut être connecté pour supprimer son compte.';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
