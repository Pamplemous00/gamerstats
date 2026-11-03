// Récupération des stats Chess.com et enregistrement dans Supabase
// (même logique que link_account.py, mais dans le navigateur).
import { supabase } from "./supabase.js";

const GAME_SLUG = "chesscom";

// Appelle l'API publique Chess.com. Renvoie null si le joueur n'existe pas.
async function fetchStats(username) {
  const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Chess.com ne répond pas, réessaie dans un instant.");
  return response.json();
}

// Extrait rating, nombre de parties et date de la dernière partie d'un mode.
function extractMode(stats, apiKey) {
  const mode = stats[apiKey];
  if (!mode?.last) return null;
  const record = mode.record ?? {};
  return {
    rating: mode.last.rating,
    games_played: (record.win ?? 0) + (record.loss ?? 0) + (record.draw ?? 0),
    last_played_at: mode.last.date ? new Date(mode.last.date * 1000).toISOString() : null,
  };
}

// Lie le pseudo au compte et enregistre ses ratings.
// L'échantillon anonyme (distribution_samples) est mis à jour côté serveur, par la mise à
// jour du lundi (nightly_refresh.py) : le site n'a plus le droit d'y écrire.
export async function linkAndRefresh(userId, username) {
  const stats = await fetchStats(username);
  if (!stats) throw new Error(`Joueur « ${username} » introuvable sur Chess.com.`);

  const { data: game, error: gameError } = await supabase
    .from("games").select("id, game_modes(id, api_key)").eq("slug", GAME_SLUG).single();
  if (gameError) throw gameError;

  const ratings = game.game_modes
    .map((mode) => ({ mode, data: extractMode(stats, mode.api_key) }))
    .filter((r) => r.data);

  const { data: account, error: accountError } = await supabase
    .from("game_accounts")
    .upsert({ user_id: userId, game_id: game.id, username }, { onConflict: "user_id,game_id" })
    .select("id")
    .single();
  if (accountError) throw accountError;

  if (ratings.length) {
    const { error: snapError } = await supabase.from("rating_snapshots").insert(
      ratings.map((r) => ({ game_account_id: account.id, mode_id: r.mode.id, ...r.data })));
    if (snapError) throw snapError;
  }
}
