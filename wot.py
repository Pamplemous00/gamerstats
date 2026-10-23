"""World of Tanks (serveur Europe) : recherche de joueur et calcul du WN8.

Utilisation (test) :
    python wot.py <pseudo>

Le WN8 est calculé nous-mêmes à partir :
  - des stats char par char en batailles aléatoires (API officielle Wargaming) ;
  - des « valeurs attendues » de chaque char publiées par XVM (mises à jour régulièrement).
"""

import os
import sys
import time

import requests
from dotenv import load_dotenv

API = "https://api.worldoftanks.eu/wot"
EXPECTED_URL = "https://static.modxvm.com/wn8-data-exp/json/wg/wn8exp.json"
TANK_FIELDS = ",".join(
    f"random.{f}" for f in ("battles", "damage_dealt", "frags", "spotted", "dropped_capture_points", "wins")
) + ",tank_id"

load_dotenv()


def app_id():
    value = (os.getenv("WG_APPLICATION_ID") or "").strip()
    if not value:
        print("Erreur : WG_APPLICATION_ID manquant dans le fichier .env")
        sys.exit(1)
    return value


def wg_get(method, **params):
    """Appelle l'API Wargaming. Renvoie le bloc `data`, ou None en cas d'erreur."""
    params["application_id"] = app_id()
    for _ in range(3):
        try:
            response = requests.get(f"{API}/{method}/", params=params, timeout=30).json()
        except (requests.RequestException, ValueError):
            time.sleep(5)
            continue
        if response.get("status") == "ok":
            return response["data"]
        if response.get("error", {}).get("message") == "REQUEST_LIMIT_EXCEEDED":
            time.sleep(1)
            continue
        return None
    return None


def load_expected():
    """Valeurs attendues XVM : {tank_id: {...}}."""
    data = requests.get(EXPECTED_URL, headers={"User-Agent": "GamerStats/0.1"}, timeout=30).json()
    return {row["IDNum"]: row for row in data["data"]}


def find_account(nickname):
    """Pseudo exact → (account_id, pseudo officiel), ou None."""
    data = wg_get("account/list", search=nickname, type="exact")
    if not data:
        return None
    return data[0]["account_id"], data[0]["nickname"]


def tank_stats(account_id):
    """Stats char par char en batailles aléatoires."""
    data = wg_get("tanks/stats", account_id=account_id, extra="random", fields=TANK_FIELDS)
    return (data or {}).get(str(account_id)) or []


def compute_wn8(tanks, expected):
    """WN8 du compte. Seuls les chars présents dans les valeurs attendues comptent.

    Renvoie (wn8, batailles prises en compte), ou (None, 0) sans batailles.
    """
    total = dict(damage=0, frags=0, spots=0, defs=0, wins=0)
    exp = dict(damage=0.0, frags=0.0, spots=0.0, defs=0.0, wins=0.0)
    battles = 0
    for tank in tanks:
        stats = tank.get("random") or {}
        n = stats.get("battles", 0)
        e = expected.get(tank["tank_id"])
        if not n or not e:
            continue
        battles += n
        total["damage"] += stats["damage_dealt"]
        total["frags"] += stats["frags"]
        total["spots"] += stats["spotted"]
        total["defs"] += stats["dropped_capture_points"]
        total["wins"] += stats["wins"]
        exp["damage"] += n * e["expDamage"]
        exp["frags"] += n * e["expFrag"]
        exp["spots"] += n * e["expSpot"]
        exp["defs"] += n * e["expDef"]
        exp["wins"] += n * e["expWinRate"] / 100
    if not battles:
        return None, 0

    r_damage = total["damage"] / exp["damage"]
    r_frag = total["frags"] / exp["frags"]
    r_spot = total["spots"] / exp["spots"]
    r_def = total["defs"] / exp["defs"]
    r_win = total["wins"] / exp["wins"]

    r_win_c = max(0, (r_win - 0.71) / (1 - 0.71))
    r_damage_c = max(0, (r_damage - 0.22) / (1 - 0.22))
    r_frag_c = max(0, min(r_damage_c + 0.2, (r_frag - 0.12) / (1 - 0.12)))
    r_spot_c = max(0, min(r_damage_c + 0.1, (r_spot - 0.38) / (1 - 0.38)))
    r_def_c = max(0, min(r_damage_c + 0.1, (r_def - 0.10) / (1 - 0.10)))

    wn8 = (980 * r_damage_c
           + 210 * r_damage_c * r_frag_c
           + 155 * r_frag_c * r_spot_c
           + 75 * r_def_c * r_frag_c
           + 145 * min(1.8, r_win_c))
    return round(wn8), battles


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Utilisation : python wot.py <pseudo>")
        sys.exit(1)
    found = find_account(sys.argv[1])
    if not found:
        print("Joueur introuvable sur le serveur Europe.")
        sys.exit(1)
    account_id, nickname = found
    wn8, battles = compute_wn8(tank_stats(account_id), load_expected())
    print(f"{nickname} (id {account_id}) : WN8 = {wn8} sur {battles} batailles aléatoires")
