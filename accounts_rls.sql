-- =====================================================================
-- Gamer Stats — comptes utilisateurs et règles de sécurité associées.
-- À exécuter dans Supabase > SQL Editor APRÈS schema_chess_mvp.sql et seed_chess_modes.sql.
-- Peut être relancé sans risque.
-- =====================================================================

-- 1. Quand quelqu'un s'inscrit (table auth.users gérée par Supabase),
--    on crée automatiquement sa fiche dans notre table users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Comptes déjà créés avant ce script : on leur crée aussi leur fiche.
insert into public.users (id, display_name)
select id, raw_user_meta_data ->> 'display_name' from auth.users
on conflict (id) do nothing;

-- 2. Règles : un membre connecté ne voit et ne modifie que SES données.
--    auth.uid() = l'identifiant du membre connecté.

-- users : sa propre fiche
grant select, insert, update on users to authenticated;
drop policy if exists "fiche perso : lecture" on users;
drop policy if exists "fiche perso : création" on users;
drop policy if exists "fiche perso : modification" on users;
create policy "fiche perso : lecture" on users
  for select to authenticated using (id = (select auth.uid()));
create policy "fiche perso : création" on users
  for insert to authenticated with check (id = (select auth.uid()));
create policy "fiche perso : modification" on users
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- game_accounts : ses propres pseudos
grant select, insert, update, delete on game_accounts to authenticated;
drop policy if exists "pseudos perso : lecture" on game_accounts;
drop policy if exists "pseudos perso : ajout" on game_accounts;
drop policy if exists "pseudos perso : modification" on game_accounts;
drop policy if exists "pseudos perso : suppression" on game_accounts;
create policy "pseudos perso : lecture" on game_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy "pseudos perso : ajout" on game_accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "pseudos perso : modification" on game_accounts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "pseudos perso : suppression" on game_accounts
  for delete to authenticated using (user_id = (select auth.uid()));

-- rating_snapshots : l'historique de ses propres pseudos
grant select, insert on rating_snapshots to authenticated;
drop policy if exists "historique perso : lecture" on rating_snapshots;
drop policy if exists "historique perso : ajout" on rating_snapshots;
create policy "historique perso : lecture" on rating_snapshots
  for select to authenticated using (
    game_account_id in (select id from game_accounts where user_id = (select auth.uid()))
  );
create policy "historique perso : ajout" on rating_snapshots
  for insert to authenticated with check (
    game_account_id in (select id from game_accounts where user_id = (select auth.uid()))
  );
