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

// Empreinte SHA-256 du pseudo (identique à player_hash() de chess_fetch.py).
async function playerHash(username) {
  const bytes = new TextEncoder().encode(`${GAME_SLUG}:${username.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Lie le pseudo au compte, enregistre ses ratings et met à jour la distribution.
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

    const hash = await playerHash(username);
    const now = new Date().toISOString();
    const { error: sampleError } = await supabase.from("distribution_samples").upsert(
      ratings.map((r) => ({ mode_id: r.mode.id, player_hash: hash, collected_at: now, ...r.data })),
      { onConflict: "mode_id,player_hash" });
    if (sampleError) throw sampleError;
  }
}
