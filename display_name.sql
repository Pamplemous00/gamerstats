-- =====================================================================
-- Gamer Stats — pseudo (nom affiché dans le classement).
-- À exécuter dans Supabase > SQL Editor APRÈS accounts_rls.sql. Peut être relancé sans risque.
--
-- Règles : 3 à 20 caractères, lettres sans accent, chiffres, « _ », « . » ou « - »,
-- et unique (sans tenir compte des majuscules).
-- Le membre modifie son pseudo lui-même (règle RLS « fiche perso : modification »).
-- =====================================================================

-- Format (« not valid » : ne vérifie pas les pseudos déjà enregistrés, seulement les nouveaux).
alter table users drop constraint if exists users_display_name_format;
alter table users add constraint users_display_name_format
  check (display_name is null or display_name ~ '^[A-Za-z0-9_.-]{3,20}$') not valid;

-- Unicité : deux membres ne peuvent pas avoir le même pseudo.
create unique index if not exists users_display_name_unique
  on users (lower(display_name)) where display_name is not null;

-- À l'inscription, on ne garde le pseudo choisi que s'il est valide et libre.
-- Sinon (ou pour une connexion Google), il reste vide et le site demandera d'en choisir un.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  wanted text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  if wanted is null
     or wanted !~ '^[A-Za-z0-9_.-]{3,20}$'
     or exists (select 1 from public.users u where lower(u.display_name) = lower(wanted)) then
    wanted := null;
  end if;
  insert into public.users (id, display_name)
  values (new.id, wanted)
  on conflict (id) do nothing;
  return new;
end;
$$;
