// Récupération des classements Lichess et enregistrement dans Supabase.
// Pas d'échantillon de joueurs à remplir : le « top » vient de la répartition officielle
// publiée par Lichess (table rating_distributions, voir lichess_distribution.py).
import { supabase } from "./supabase.js";

const GAME_SLUG = "lichess";

// Profil public Lichess. Renvoie null si le joueur n'existe pas.
async function fetchUser(username) {
  const response = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (response.status === 429) throw new Error("Lichess reçoit trop de demandes, réessaie dans une minute.");
  if (!response.ok) throw new Error("Lichess ne répond pas, réessaie dans un instant.");
  return response.json();
}

// Classement d'un mode. Les classements provisoires (« ? » sur Lichess) ne comptent pas :
// la répartition officielle ne contient que les classements établis.
function extractMode(user, apiKey) {
  const perf = user.perfs?.[apiKey];
  if (!perf || !perf.games || perf.prov) return null;
  return {
    rating: perf.rating,
    games_played: perf.games,
    last_played_at: user.seenAt ? new Date(user.seenAt).toISOString() : null,
  };
}

// Lie le pseudo au compte et enregistre ses classements.
export async function linkAndRefresh(userId, username) {
  const user = await fetchUser(username);
  if (!user || user.disabled) throw new Error(`Joueur « ${username} » introuvable sur Lichess.`);

  const { data: game, error: gameError } = await supabase
    .from("games").select("id, game_modes(id, api_key)").eq("slug", GAME_SLUG).single();
  if (gameError) throw gameError;

  const ratings = game.game_modes
    .map((mode) => ({ mode, data: extractMode(user, mode.api_key) }))
    .filter((r) => r.data);
  if (!ratings.length) {
    throw new Error("Aucun classement établi sur Lichess (Bullet, Blitz, Rapide ou Classique) : joue encore quelques parties classées.");
  }

  const { data: account, error: accountError } = await supabase
    .from("game_accounts")
    .upsert({ user_id: userId, game_id: game.id, username: user.username ?? username },
            { onConflict: "user_id,game_id" })
    .select("id")
    .single();
  if (accountError) throw accountError;

  const { error: snapError } = await supabase.from("rating_snapshots").insert(
    ratings.map((r) => ({ game_account_id: account.id, mode_id: r.mode.id, ...r.data })));
  if (snapError) throw snapError;
}
