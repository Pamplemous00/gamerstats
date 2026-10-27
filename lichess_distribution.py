"""Récupère la répartition officielle des classements Lichess et prépare le SQL de chargement.

Usage :
    python lichess_distribution.py            -> écrit lichess_distribution.sql
    python lichess_distribution.py --install  -> écrit lichess_install.sql
                                                 (seed_lichess.sql + scores.sql + répartition)

Ensuite : copier le fichier dans Supabase > SQL Editor et cliquer sur Run.
Lichess met ces chiffres à jour chaque semaine (joueurs actifs de la semaine,
classements établis uniquement) : relancer le script de temps en temps.

Format publié par Lichess (page https://lichess.org/stat/rating/distribution/<mode>) :
une liste « freq » de nombres de joueurs par tranche de 25 points, à partir de 400.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

MODES = ["bullet", "blitz", "rapid", "classical"]
FIRST_BUCKET = 400
STEP = 25
HERE = Path(__file__).parent


def fetch_freq(mode: str) -> list[int]:
    request = urllib.request.Request(
        f"https://lichess.org/stat/rating/distribution/{mode}",
        headers={"User-Agent": "GamerStats (https://pamplemous00.github.io/gamerstats/)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8")
    match = re.search(r'"freq":(\[[0-9,]*\])', html)
    if not match:
        raise RuntimeError(f"Répartition introuvable pour {mode} : la page Lichess a peut-être changé.")
    freq = json.loads(match.group(1))
    if len(freq) < 50:
        raise RuntimeError(f"Répartition {mode} trop courte ({len(freq)} tranches) : format inattendu.")
    return freq


def mode_sql(mode: str, freq: list[int]) -> str:
    values = ",\n  ".join(f"({FIRST_BUCKET + STEP * i}, {n})" for i, n in enumerate(freq))
    return f"""-- Lichess {mode} : {sum(freq):,} joueurs actifs, {len(freq)} tranches
insert into rating_distributions (mode_id, bucket_min, players, updated_at)
select gm.id, v.bucket_min, v.players, now()
from game_modes gm
join games g on g.id = gm.game_id
cross join (values
  {values}
) as v (bucket_min, players)
where g.slug = 'lichess' and gm.slug = '{mode}'
on conflict (mode_id, bucket_min) do update
  set players = excluded.players, updated_at = excluded.updated_at;
"""


def main() -> None:
    parts = []
    for mode in MODES:
        freq = fetch_freq(mode)
        print(f"{mode:9} : {sum(freq):>9,} joueurs, tranches de {FIRST_BUCKET} à {FIRST_BUCKET + STEP * (len(freq) - 1)}")
        parts.append(mode_sql(mode, freq))
    data = "-- Répartition officielle Lichess (généré par lichess_distribution.py)\n\n" + "\n".join(parts)

    if "--install" in sys.argv:
        out = HERE / "lichess_install.sql"
        out.write_text(
            (HERE / "seed_lichess.sql").read_text(encoding="utf-8") + "\n\n"
            + (HERE / "scores.sql").read_text(encoding="utf-8") + "\n\n" + data,
            encoding="utf-8",
        )
    else:
        out = HERE / "lichess_distribution.sql"
        out.write_text(data, encoding="utf-8")
    print(f"Écrit : {out.name}")


if __name__ == "__main__":
    main()
