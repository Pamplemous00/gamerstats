"""Récupère les ratings Chess.com d'un joueur et les ajoute à distribution_samples.

Utilisation :
    python chess_fetch.py <pseudo>
"""

import hashlib
import os
import sys
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from supabase import create_client

GAME_SLUG = "chesscom"
API_URL = "https://api.chess.com/pub/player/{username}/stats"
# Chess.com demande d'identifier les programmes qui appellent son API.
HEADERS = {"User-Agent": "GamerStats/0.1 (projet personnel)"}


def fetch_stats(username):
    """Appelle l'API Chess.com. Renvoie le JSON, ou None si le joueur n'existe pas."""
    response = requests.get(API_URL.format(username=username), headers=HEADERS, timeout=10)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def player_hash(username):
    """Empreinte du pseudo : permet d'éviter les doublons sans stocker le pseudo en clair."""
    return hashlib.sha256(f"{GAME_SLUG}:{username.lower()}".encode()).hexdigest()


def extract_mode(stats, api_key):
    """Extrait rating, nombre de parties et date de la dernière partie pour un mode."""
    mode = stats.get(api_key)
    if not mode or "last" not in mode:
        return None
    record = mode.get("record", {})
    games_played = record.get("win", 0) + record.get("loss", 0) + record.get("draw", 0)
    last_date = mode["last"].get("date")
    return {
        "rating": mode["last"]["rating"],
        "games_played": games_played,
        "last_played_at": (
            datetime.fromtimestamp(last_date, tz=timezone.utc).isoformat() if last_date else None
        ),
    }


def connect():
    """Crée le client Supabase à partir du fichier .env."""
    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Erreur : SUPABASE_URL ou SUPABASE_KEY manquant dans le fichier .env")
        sys.exit(1)
    return create_client(url, key)


def fetch_ratings(supabase, username):
    """Récupère et affiche les ratings du joueur pour chaque mode Chess.com.

    Renvoie une liste de (mode, data) pour les modes où le joueur a des parties.
    """
    stats = fetch_stats(username)
    if stats is None:
        print(f"Joueur « {username} » introuvable sur Chess.com.")
        sys.exit(1)

    modes = (
        supabase.table("game_modes")
        .select("id, name, api_key, games!inner(slug)")
        .eq("games.slug", GAME_SLUG)
        .execute()
        .data
    )
    if not modes:
        print("Erreur : aucun mode Chess.com en base. As-tu exécuté seed_chess_modes.sql ?")
        sys.exit(1)

    ratings = []
    print(f"Ratings de {username} :")
    for mode in modes:
        data = extract_mode(stats, mode["api_key"])
        if data is None:
            print(f"  {mode['name']:<7} : pas de parties")
            continue
        print(f"  {mode['name']:<7} : {data['rating']} ({data['games_played']} parties)")
        ratings.append((mode, data))
    return ratings


def save_samples(supabase, username, ratings):
    """Ajoute ou met à jour les échantillons anonymisés dans distribution_samples."""
    rows = [
        {
            "mode_id": mode["id"],
            "player_hash": player_hash(username),
            "collected_at": datetime.now(timezone.utc).isoformat(),
            **data,
        }
        for mode, data in ratings
    ]
    if rows:
        supabase.table("distribution_samples").upsert(rows, on_conflict="mode_id,player_hash").execute()
    print(f"{len(rows)} échantillon(s) enregistré(s) dans distribution_samples.")


def main():
    if len(sys.argv) != 2:
        print("Utilisation : python chess_fetch.py <pseudo>")
        sys.exit(1)
    username = sys.argv[1].strip()

    supabase = connect()
    ratings = fetch_ratings(supabase, username)
    save_samples(supabase, username, ratings)


if __name__ == "__main__":
    main()
