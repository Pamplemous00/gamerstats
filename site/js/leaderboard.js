// Classement global : top 10 + la position du membre connecté s'il est en dehors.
import { supabase, formatNumber } from "./supabase.js";

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function row(entry) {
  return `
    <li class="lb-row${entry.is_me ? " me" : ""}">
      <span class="lb-place">${entry.place}</span>
      <span class="lb-name">${escapeHtml(entry.display_name)}${entry.is_me ? " <small>(toi)</small>" : ""}</span>
      <span class="lb-score">${formatNumber(entry.total_score)}</span>
    </li>`;
}

// Affiche le classement dans l'élément `container`.
export async function renderLeaderboard(container) {
  const { data, error } = await supabase.rpc("get_leaderboard");
  if (error) {
    container.innerHTML = `<p class="muted">Classement indisponible pour le moment.</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<p class="muted">Aucun joueur classé pour l'instant.</p>`;
    return;
  }

  const top = data.filter((e) => e.place <= 10);
  const me = data.find((e) => e.is_me && e.place > 10);
  container.innerHTML = `
    <ol class="lb-list">
      ${top.map(row).join("")}
      ${me ? `<li class="lb-gap" aria-hidden="true">…</li>${row(me)}` : ""}
    </ol>
    <p class="muted lb-count">${formatNumber(data[0].total_players)} joueur${data[0].total_players > 1 ? "s" : ""} classé${data[0].total_players > 1 ? "s" : ""}</p>`;
}
