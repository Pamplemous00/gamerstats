// Classement : top 10 + la place du membre connecté s'il est en dehors.
// Global (tous les jeux) ou limité à une sélection de jeux (cases sur les cartes du profil).
import { supabase, formatNumber } from "./supabase.js";
import { GAMES } from "./games.js";

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const gameBySlug = (slug) => GAMES.find((g) => g.slug === slug);

// Petites icônes des jeux du joueur, du meilleur au moins bon (classement global uniquement).
function gameIcons(slugs) {
  return `<span class="lb-games">${(slugs ?? []).map(gameBySlug).filter((g) => g?.image)
    .map((g) => `<img src="${g.image}" alt="${escapeHtml(g.name)}" title="${escapeHtml(g.name)}">`).join("")}</span>`;
}

function row(entry, global) {
  const rank = entry.place <= 3 ? ` r${entry.place}` : "";
  return `
    <li class="lb-row${rank}${entry.is_me ? " me" : ""}">
      <span class="lb-place">${entry.place}</span>
      <span class="lb-name">${escapeHtml(entry.display_name)}</span>
      ${global ? gameIcons(entry.games) : "<span></span>"}
      <span class="lb-score">${formatNumber(entry.total_score)}</span>
    </li>`;
}

// Étiquettes en haut à droite du classement : « Global » ou les jeux choisis (+ × pour revenir).
function renderCategory(holder, games, onReset) {
  if (!holder) return;
  if (!games.length) {
    holder.innerHTML = `<span class="lb-chip global">🌍 Global</span>`;
    return;
  }
  holder.innerHTML = games.map(gameBySlug).filter(Boolean).map((g) =>
    `<span class="lb-chip">${g.image ? `<img src="${g.image}" alt="">` : ""}${escapeHtml(g.name)}</span>`).join("")
    + `<button type="button" class="lb-chip lb-reset" title="Revenir au classement global" aria-label="Revenir au classement global">×</button>`;
  holder.querySelector(".lb-reset").addEventListener("click", () => onReset?.());
}

// Affiche le classement dans l'élément `container`.
// games : slugs des jeux choisis ([] = global) ; onReset : appelé quand on clique sur ×.
export async function renderLeaderboard(container, { games = [], onReset } = {}) {
  const global = !games.length;
  renderCategory(container.closest(".leaderboard")?.querySelector(".lb-cat"), games, onReset);

  const { data, error } = await supabase.rpc("get_leaderboard", { p_games: global ? null : games });
  if (error) {
    container.innerHTML = `<p class="muted">Classement indisponible pour le moment.</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<p class="muted">${global
      ? "Aucun joueur classé pour l'instant."
      : `Personne n'a encore ${games.length > 1 ? "tous ces jeux" : "ce jeu"}.`}</p>`;
    return;
  }

  const top = data.filter((e) => e.place <= 10);
  const me = data.find((e) => e.is_me && e.place > 10);
  container.innerHTML = `
    <ol class="lb-list">
      ${top.map((e) => row(e, global)).join("")}
      ${me ? `<li class="lb-gap" aria-hidden="true">•••</li>${row(me, global)}` : ""}
    </ol>`;
}
