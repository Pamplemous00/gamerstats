"""Remplit distribution_samples avec des joueurs européens tirés au hasard.

Utilisation :
    python seed_distribution.py [--target 1000] [--max-requests 6000]

Le script tire des joueurs au hasard dans les listes par pays de Chess.com
et s'arrête quand chaque mode a au moins `target` joueurs récents
(ou après `max-requests` joueurs interrogés).

Limite connue : pour les grands pays, Chess.com ne renvoie que les 10 000
premiers pseudos par ordre alphabétique (chiffres et début de la lettre « a »).
"""

import argparse
import random
import time
from datetime import datetime, timedelta, timezone

import requests

from chess_fetch import GAME_SLUG, HEADERS, connect, extract_mode, player_hash

COUNTRIES_URL = "https://api.chess.com/pub/country/{iso}/players"
STATS_URL = "https://api.chess.com/pub/player/{username}/stats"

# Codes pays européens (ISO 3166) + codes Chess.com pour l'Angleterre,
# l'Écosse, le Pays de Galles, le Pays basque et la Catalogne.
EUROPE = [
    "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK",
    "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI",
    "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT",
    "RO", "RS", "RU", "SE", "SI", "SK", "SM", "TR", "UA", "VA", "XK",
    "XE", "XS", "XW", "XB", "XC",
]
RECENT_DAYS = 182  # « joueur récent » = a joué dans le mode depuis moins de 6 mois
PAUSE = 0.2        # pause entre deux requêtes, pour ne pas surcharger Chess.com


def get_json(url):
    """GET poli vers Chess.com : attend et réessaie si on va trop vite. None si erreur."""
    for _ in range(3):
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
        except requests.RequestException:
            time.sleep(5)
            continue
        if response.status_code == 429:  # trop de requêtes : on patiente
            time.sleep(60)
            continue
        if response.ok:
            return response.json()
        return None
    return None


def load_usernames():
    """Récupère et mélange les pseudos de tous les pays européens."""
    usernames = set()
    for iso in EUROPE:
        data = get_json(COUNTRIES_URL.format(iso=iso))
        players = data.get("players", []) if data else []
        print(f"  {iso} : {len(players)} joueurs")
        usernames.update(players)
        time.sleep(PAUSE)
    usernames = list(usernames)
    random.shuffle(usernames)
    return usernames


def count_recent(supabase, modes, cutoff):
    """Nombre de joueurs récents déjà en base, par mode."""
    counts = {}
    for mode in modes:
        result = (
            supabase.table("distribution_samples")
            .select("id", count="exact", head=True)
            .eq("mode_id", mode["id"])
            .gte("last_played_at", cutoff.isoformat())
            .execute()
        )
        counts[mode["id"]] = result.count or 0
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=1000)
    parser.add_argument("--max-requests", type=int, default=6000)
    args = parser.parse_args()

    supabase = connect()
    modes = (
        supabase.table("game_modes")
        .select("id, name, api_key, games!inner(slug)")
        .eq("games.slug", GAME_SLUG)
        .execute()
        .data
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)
    counts = count_recent(supabase, modes, cutoff)

    print("Récupération des listes de joueurs par pays...")
    usernames = load_usernames()
    print(f"{len(usernames)} pseudos disponibles. Début du tirage.\n")

    def show_progress(done):
        detail = ", ".join(f"{m['name']} {counts[m['id']]}" for m in modes)
        print(f"[{done} joueurs interrogés] joueurs récents : {detail}")

    pending = []  # lignes en attente, envoyées par paquets (Supabase peut être lent)

    def flush():
        if not pending:
            return
        for attempt in range(5):  # réessaie en cas de coupure réseau passagère
            try:
                supabase.table("distribution_samples").upsert(pending, on_conflict="mode_id,player_hash").execute()
                break
            except Exception as error:
                print(f"Supabase injoignable ({error.__class__.__name__}), nouvel essai dans 30 s...")
                time.sleep(30)
        else:
            print("Supabase toujours injoignable : ce paquet de joueurs est abandonné.")
        pending.clear()

    done = 0
    for username in usernames:
        if done >= args.max_requests or all(c >= args.target for c in counts.values()):
            break
        stats = get_json(STATS_URL.format(username=username))
        done += 1
        time.sleep(PAUSE)
        if not stats:
            continue

        for mode in modes:
            data = extract_mode(stats, mode["api_key"])
            if data is None:
                continue
            pending.append({
                "mode_id": mode["id"],
                "player_hash": player_hash(username),
                "collected_at": datetime.now(timezone.utc).isoformat(),
                **data,
            })
            if data["last_played_at"] and datetime.fromisoformat(data["last_played_at"]) >= cutoff:
                counts[mode["id"]] += 1
        if done % 50 == 0:
            flush()
            show_progress(done)

    flush()
    show_progress(done)
    print("Terminé.")


if __name__ == "__main__":
    main()
