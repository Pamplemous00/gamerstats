-- =====================================================================
-- Gamer Stats — classement global.
-- À exécuter dans Supabase > SQL Editor APRÈS scores.sql.
-- Peut être relancé sans risque.
--
-- get_leaderboard() renvoie le top 10 des comptes (score total du profil),
-- plus la ligne du membre connecté s'il est en dehors du top 10.
-- Accessible à tous (même sans être connecté). N'expose ni email ni identifiant :
-- seulement le nom affiché (ou « Joueur XXXX » si le membre n'en a pas choisi).
-- =====================================================================

drop function if exists public.get_leaderboard();

create function public.get_leaderboard()
returns table (place bigint, display_name text, total_score numeric,
               is_me boolean, total_players bigint)
language sql
stable
security definer set search_path = ''
as $$
  with ranked as (
    select ps.user_id,
           coalesce(nullif(trim(u.display_name), ''),
                    'Joueur ' || upper(left(md5(ps.user_id::text), 4))) as name,
           ps.total_score,
           rank() over (order by ps.total_score desc) as pos,
           count(*) over () as n
    from public.profile_scores ps
    join public.users u on u.id = ps.user_id
    where ps.total_score > 0
  )
  select pos, name, total_score, coalesce(user_id = auth.uid(), false), n
  from ranked
  where pos <= 10 or user_id = auth.uid()
  order by pos, name;
$$;

grant execute on function public.get_leaderboard() to anon, authenticated;
