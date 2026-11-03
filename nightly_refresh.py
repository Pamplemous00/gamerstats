"""Mise à jour automatique (chaque nuit, via GitHub Actions : .github/workflows/nightly.yml).

1. Relit le classement de chaque pseudo lié (Chess.com, Lichess, World of Tanks) et
   enregistre une nouvelle « photo » (rating_snapshots) quand il a changé.
2. Une fois par semaine (le lundi, ou avec --lichess) : met à jour la répartition officielle
   Lichess (table rating_distributions).
3. Recalcule les scores de tous les membres (compute_all_scores), donc le classement.

Variables nécessaires (secrets GitHub, ou .env pour un essai local) :
    SUPABASE_URL, SUPABASE_SERVICE_KEY (clé secrète, jamais dans le code), WG_APPLICATION_ID

Les journaux de GitHub Actions sont publics (dépôt public) : on n'y écrit que des
compteurs, jamais de pseudo ni d'email.
"""
import hashlib
import os
import sys
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from supabase import create_client

import chess_fetch
import lichess_distribution
import wot

LICHESS_HEADERS = {"User-Agent": "GamerStats (https://pamplemous00.github.io/gamerstats/)", "Accept": "application/json"}
WOT_MIN_BATTLES = 100


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat() if timestamp else None


# ----- Lecture des classements, jeu par jeu -----
# Chaque fonction renvoie ({api_key du mode: {rating, games_played, last_played_at}}, player_hash ou None).
# player_hash : pour mettre aussi à jour l'échantillon anonyme (Chess.com, WoT), comme le site.

def read_chesscom(username, _context):
    stats = chess_fetch.fetch_stats(username)
    if stats is None:
        return {}, None
    modes = {}
    for api_key in ("chess_bullet", "chess_blitz", "chess_rapid"):
        data = chess_fetch.extract_mode(stats, api_key)
        if data:
            modes[api_key] = data
    return modes, chess_fetch.player_hash(username)


def read_lichess(username, _context):
    response = requests.get(f"https://lichess.org/api/user/{username}", headers=LICHESS_HEADERS, timeout=30)
    if response.status_code == 429:  # trop de demandes : on attend une minute et on réessaie
        time.sleep(60)
        response = requests.get(f"https://lichess.org/api/user/{username}", headers=LICHESS_HEADERS, timeout=30)
    if response.status_code == 404:
        return {}, None
    response.raise_for_status()
    user = response.json()
    if user.get("disabled"):
        return {}, None
    seen = iso(user["seenAt"] / 1000) if user.get("seenAt") else None
    modes = {}
    for api_key in ("bullet", "blitz", "rapid", "classical"):
        perf = (user.get("perfs") or {}).get(api_key)
        if perf and perf.get("games") and not perf.get("prov"):
            modes[api_key] = {"rating": perf["rating"], "games_played": perf["games"], "last_played_at": seen}
    time.sleep(1)  # politesse envers l'API Lichess
    return modes, None


def read_wot(username, context):
    found = wot.find_account(username)
    if not found:
        return {}, None
    account_id, _ = found
    if "wot_expected" not in context:
        context["wot_expected"] = wot.load_expected()
    wn8, battles = wot.compute_wn8(wot.tank_stats(account_id), context["wot_expected"])
    if wn8 is None or battles < WOT_MIN_BATTLES:
        return {}, None
    info = wot.wg_get("account/info", account_id=account_id, fields="last_battle_time") or {}
    last = (info.get(str(account_id)) or {}).get("last_battle_time")
    data = {"rating": wn8, "games_played": battles, "last_played_at": iso(last)}
    return {"wn8": data}, hashlib.sha256(f"wot:{account_id}".encode()).hexdigest()


READERS = {"chesscom": read_chesscom, "lichess": read_lichess, "wot": read_wot}


def refresh_ratings(db):
    modes = db.table("game_modes").select("id, api_key, games(slug)").execute().data
    mode_id = {(m["games"]["slug"], m["api_key"]): m["id"] for m in modes}
    accounts = db.table("game_accounts").select("id, username, games(slug)").execute().data

    context, counts = {}, {"comptes": 0, "nouvelles photos": 0, "inchangés": 0, "introuvables": 0, "erreurs": 0}
    for account in accounts:
        slug = account["games"]["slug"]
        reader = READERS.get(slug)
        if not reader:
            continue
        counts["comptes"] += 1
        try:
            ratings, sample_hash = reader(account["username"], context)
        except Exception as error:  # un compte en erreur ne bloque pas les autres
            counts["erreurs"] += 1
            print(f"  erreur ({slug}) : {type(error).__name__}")
            continue
        if not ratings:
            counts["introuvables"] += 1
            continue

        # Dernier classement connu pour chaque mode : on n'ajoute une photo que s'il a changé.
        previous = {}
        for snap in (db.table("rating_snapshots").select("mode_id, rating")
                     .eq("game_account_id", account["id"]).order("fetched_at", desc=True)
                     .limit(50).execute().data):
            previous.setdefault(snap["mode_id"], snap["rating"])

        new_rows, samples = [], []
        for api_key, data in ratings.items():
            mid = mode_id.get((slug, api_key))
            if mid is None:
                continue
            if previous.get(mid) != data["rating"]:
                new_rows.append({"game_account_id": account["id"], "mode_id": mid, **data})
            if sample_hash:
                samples.append({"mode_id": mid, "player_hash": sample_hash,
                                "collected_at": datetime.now(timezone.utc).isoformat(), **data})
        if new_rows:
            db.table("rating_snapshots").insert(new_rows).execute()
            counts["nouvelles photos"] += len(new_rows)
        else:
            counts["inchangés"] += 1
        if samples:
            db.table("distribution_samples").upsert(samples, on_conflict="mode_id,player_hash").execute()
    print("Classements :", ", ".join(f"{k} {v}" for k, v in counts.items()))


def refresh_lichess_distribution(db):
    modes = (db.table("game_modes").select("id, slug, games!inner(slug)")
             .eq("games.slug", "lichess").execute().data)
    now = datetime.now(timezone.utc).isoformat()
    for mode in modes:
        freq = lichess_distribution.fetch_freq(mode["slug"])
        rows = [{"mode_id": mode["id"], "players": n, "updated_at": now,
                 "bucket_min": lichess_distribution.FIRST_BUCKET + lichess_distribution.STEP * i}
                for i, n in enumerate(freq)]
        db.table("rating_distributions").upsert(rows, on_conflict="mode_id,bucket_min").execute()
        print(f"Répartition Lichess {mode['slug']} : {sum(freq):,} joueurs")
        time.sleep(1)


def main():
    load_dotenv()
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("Erreur : SUPABASE_URL ou SUPABASE_SERVICE_KEY manquant.")
        sys.exit(1)
    db = create_client(url.strip(), key.strip())

    refresh_ratings(db)
    if "--lichess" in sys.argv or datetime.now(timezone.utc).weekday() == 0:
        refresh_lichess_distribution(db)
    members = db.rpc("compute_all_scores").execute().data
    print(f"Scores recalculés pour {members} membre(s).")


if __name__ == "__main__":
    main()
