// World of Tanks (serveur Europe) : recherche du joueur, calcul du WN8 et
// enregistrement dans Supabase (même logique que wot.py).
import { supabase } from "./supabase.js";
import { WG_APPLICATION_ID } from "./config.js";

const GAME_SLUG = "wot";
const API = "https://api.worldoftanks.eu/wot";
const EXPECTED_URL = "https://static.modxvm.com/wn8-data-exp/json/wg/wn8exp.json";
const MIN_BATTLES = 100;

// Appelle l'API Wargaming et renvoie le bloc `data`.
async function wgGet(method, params) {
  const query = new URLSearchParams({ application_id: WG_APPLICATION_ID, ...params });
  const response = await fetch(`${API}/${method}/?${query}`);
  const json = await response.json();
  if (json.status !== "ok") throw new Error("Wargaming ne répond pas, réessaie dans un instant.");
  return json.data;
}

// Valeurs attendues XVM, chargées une seule fois : { tank_id: {...} }.
let expectedCache = null;
async function loadExpected() {
  if (!expectedCache) {
    const json = await (await fetch(EXPECTED_URL)).json();
    expectedCache = Object.fromEntries(json.data.map((row) => [row.IDNum, row]));
  }
  return expectedCache;
}

// WN8 du compte (formule officielle), à partir des stats char par char en batailles aléatoires.
function computeWn8(tanks, expected) {
  const t = { damage: 0, frags: 0, spots: 0, defs: 0, wins: 0 };
  const e = { damage: 0, frags: 0, spots: 0, defs: 0, wins: 0 };
  let battles = 0;
  for (const tank of tanks) {
    const s = tank.random ?? {};
    const exp = expected[tank.tank_id];
    if (!s.battles || !exp) continue;
    const n = s.battles;
    battles += n;
    t.damage += s.damage_dealt; t.frags += s.frags; t.spots += s.spotted;
    t.defs += s.dropped_capture_points; t.wins += s.wins;
    e.damage += n * exp.expDamage; e.frags += n * exp.expFrag; e.spots += n * exp.expSpot;
    e.defs += n * exp.expDef; e.wins += (n * exp.expWinRate) / 100;
  }
  if (!battles) return { wn8: null, battles: 0 };

  const rWinC = Math.max(0, (t.wins / e.wins - 0.71) / (1 - 0.71));
  const rDamageC = Math.max(0, (t.damage / e.damage - 0.22) / (1 - 0.22));
  const rFragC = Math.max(0, Math.min(rDamageC + 0.2, (t.frags / e.frags - 0.12) / (1 - 0.12)));
  const rSpotC = Math.max(0, Math.min(rDamageC + 0.1, (t.spots / e.spots - 0.38) / (1 - 0.38)));
  const rDefC = Math.max(0, Math.min(rDamageC + 0.1, (t.defs / e.defs - 0.1) / (1 - 0.1)));
  const wn8 = 980 * rDamageC + 210 * rDamageC * rFragC + 155 * rFragC * rSpotC
    + 75 * rDefC * rFragC + 145 * Math.min(1.8, rWinC);
  return { wn8: Math.round(wn8), battles };
}

// Empreinte SHA-256 du compte (identique à player_hash() de seed_wot_distribution.py).
async function playerHash(accountId) {
  const bytes = new TextEncoder().encode(`${GAME_SLUG}:${accountId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Lie le pseudo au compte, calcule le WN8, l'enregistre et met à jour la distribution.
export async function linkAndRefresh(userId, nickname) {
  const found = await wgGet("account/list", { search: nickname, type: "exact" });
  if (!found.length) throw new Error(`Joueur « ${nickname} » introuvable sur le serveur Europe.`);
  const { account_id: accountId, nickname: officialName } = found[0];

  const [info, tanks, expected] = await Promise.all([
    wgGet("account/info", { account_id: accountId, fields: "last_battle_time" }),
    wgGet("tanks/stats", {
      account_id: accountId, extra: "random",
      fields: "tank_id,random.battles,random.damage_dealt,random.frags,random.spotted,random.dropped_capture_points,random.wins",
    }),
    loadExpected(),
  ]);
  const { wn8, battles } = computeWn8(tanks[accountId] ?? [], expected);
  if (wn8 === null || battles < MIN_BATTLES) {
    throw new Error(`Il faut au moins ${MIN_BATTLES} batailles aléatoires pour calculer un WN8 fiable.`);
  }
  const lastBattle = info[accountId]?.last_battle_time;
  const lastPlayedAt = lastBattle ? new Date(lastBattle * 1000).toISOString() : null;

  const { data: game, error: gameError } = await supabase
    .from("games").select("id, game_modes(id)").eq("slug", GAME_SLUG).single();
  if (gameError) throw gameError;
  const modeId = game.game_modes[0].id;

  const { data: account, error: accountError } = await supabase
    .from("game_accounts")
    .upsert({ user_id: userId, game_id: game.id, username: officialName }, { onConflict: "user_id,game_id" })
    .select("id")
    .single();
  if (accountError) throw accountError;

  const row = { rating: wn8, games_played: battles, last_played_at: lastPlayedAt };
  const { error: snapError } = await supabase.from("rating_snapshots")
    .insert({ game_account_id: account.id, mode_id: modeId, ...row });
  if (snapError) throw snapError;

  const { error: sampleError } = await supabase.from("distribution_samples").upsert(
    { mode_id: modeId, player_hash: await playerHash(accountId), collected_at: new Date().toISOString(), ...row },
    { onConflict: "mode_id,player_hash" });
  if (sampleError) throw sampleError;
}
