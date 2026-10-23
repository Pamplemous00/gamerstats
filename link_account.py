"""Lie un pseudo Chess.com au compte connecté et enregistre ses ratings.

Utilisation :
    python link_account.py <pseudo>

Le compte utilisé est celui de TEST_EMAIL / TEST_PASSWORD dans le fichier .env
(en attendant la page de connexion du site).
"""

import os
import sys

from chess_fetch import GAME_SLUG, connect, fetch_ratings, save_samples


def sign_in(supabase):
    """Connecte le compte de test. Renvoie l'identifiant du membre."""
    email = os.getenv("TEST_EMAIL")
    password = os.getenv("TEST_PASSWORD")
    if not email or not password:
        print("Erreur : TEST_EMAIL ou TEST_PASSWORD manquant dans le fichier .env")
        sys.exit(1)
    try:
        response = supabase.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as error:
        print(f"Connexion impossible : {error}")
        sys.exit(1)
    return response.user.id


def link_account(supabase, user_id, username):
    """Crée (ou met à jour) le lien membre ↔ pseudo. Renvoie l'id de game_accounts."""
    game = supabase.table("games").select("id").eq("slug", GAME_SLUG).single().execute().data
    account = (
        supabase.table("game_accounts")
        .upsert(
            {"user_id": user_id, "game_id": game["id"], "username": username},
            on_conflict="user_id,game_id",
        )
        .execute()
        .data[0]
    )
    return account["id"]


def save_snapshots(supabase, game_account_id, ratings):
    """Ajoute les ratings du jour à l'historique (rating_snapshots)."""
    rows = [
        {"game_account_id": game_account_id, "mode_id": mode["id"], **data}
        for mode, data in ratings
    ]
    if rows:
        supabase.table("rating_snapshots").insert(rows).execute()
    print(f"{len(rows)} rating(s) ajouté(s) à l'historique (rating_snapshots).")


def show_scores(supabase):
    """Lance le calcul des scores dans Supabase et affiche le résultat."""
    rows = supabase.rpc("compute_my_scores").execute().data
    print("\nScores :")
    for row in rows:
        print(
            f"  {row['mode']:<7} : rating {row['rating']}, percentile {row['percentile']} "
            f"(sur {row['sample_size']} joueurs) -> Elo équivalent Blitz {row['equivalent_elo']:.0f} "
            f"-> {row['points']:.0f} points"
        )
    total = supabase.table("profile_scores").select("total_score").single().execute().data
    print(f"Score total du profil : {total['total_score']:.0f} points")


def main():
    if len(sys.argv) != 2:
        print("Utilisation : python link_account.py <pseudo>")
        sys.exit(1)
    username = sys.argv[1].strip()

    supabase = connect()
    user_id = sign_in(supabase)
    ratings = fetch_ratings(supabase, username)

    game_account_id = link_account(supabase, user_id, username)
    print(f"Pseudo « {username} » lié à ton compte.")
    save_snapshots(supabase, game_account_id, ratings)
    save_samples(supabase, username, ratings)
    show_scores(supabase)


if __name__ == "__main__":
    main()
