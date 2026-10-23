"""Remplit distribution_samples avec le WN8 de joueurs World of Tanks européens tirés au hasard.

Utilisation :
    python seed_wot_distribution.py [--target 1000]

Les identifiants de comptes du serveur Europe se suivent : on tire des numéros
au hasard, l'API Wargaming dit lesquels existent, et on garde les joueurs actifs
(au moins 100 batailles aléatoires, dernière bataille il y a moins de 6 mois).
C'est un vrai tirage au hasard, sans biais de pseudo.
"""

import argparse
import hashlib
import random
import time
from datetime import datetime, timedelta, timezone

from chess_fetch import connect
from wot import compute_wn8, load_expected, tank_stats, wg_get

ID_MIN, ID_MAX = 500_000_000, 620_000_000  # plage des comptes du serveur Europe
MIN_BATTLES = 100
RECENT_DAYS = 182


def player_hash(account_id):
    """Empreinte du compte (identique à playerHash() de site/js/wot.js)."""
    return hashlib.sha256(f"wot:{account_id}".encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=1000)
    args = parser.parse_args()

    supabase = connect()
    mode = (
        supabase.table("game_modes").select("id, games!inner(slug)")
        .eq("games.slug", "wot").eq("slug", "wn8").single().execute().data
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)
    count = (
        supabase.table("distribution_samples").select("id", count="exact", head=True)
        .eq("mode_id", mode["id"]).gte("last_played_at", cutoff.isoformat()).execute().count or 0
    )
    expected = load_expected()
    print(f"Joueurs WN8 récents déjà en base : {count}. Objectif : {args.target}.")

    tested = 0
    while count < args.target:
        ids = random.sample(range(ID_MIN, ID_MAX), 100)
        tested += 100
        infos = wg_get("account/info", account_id=",".join(map(str, ids)), extra="statistics.random",
                       fields="last_battle_time,statistics.random.battles") or {}
        rows = []
        for account_id, info in infos.items():
            if not info or not info["last_battle_time"]:
                continue
            last = datetime.fromtimestamp(info["last_battle_time"], tz=timezone.utc)
            if last < cutoff or info["statistics"]["random"]["battles"] < MIN_BATTLES:
                continue
            wn8, battles = compute_wn8(tank_stats(account_id), expected)
            time.sleep(0.1)
            if wn8 is None or battles < MIN_BATTLES:
                continue
            rows.append({
                "mode_id": mode["id"],
                "player_hash": player_hash(account_id),
                "rating": wn8,
                "games_played": battles,
                "last_played_at": last.isoformat(),
                "collected_at": datetime.now(timezone.utc).isoformat(),
            })
        if rows:
            for _ in range(5):  # réessaie en cas de coupure réseau passagère
                try:
                    supabase.table("distribution_samples").upsert(rows, on_conflict="mode_id,player_hash").execute()
                    break
                except Exception:
                    time.sleep(30)
            count += len(rows)
        if tested % 5000 == 0:
            print(f"[{tested} numéros testés] joueurs WN8 récents : {count}")
        time.sleep(0.1)

    print(f"Terminé : {count} joueurs WN8 récents ({tested} numéros testés).")


if __name__ == "__main__":
    main()
