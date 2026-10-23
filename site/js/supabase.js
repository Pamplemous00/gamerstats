// Client Supabase partagé par toutes les pages, et petits outils communs.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Renvoie l'utilisateur connecté, ou null.
export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// Met à jour le menu selon que l'on est connecté ou non.
export async function setupNav() {
  setupBrandMenu();
  const user = await currentUser();
  const nav = document.querySelector("[data-nav-account]");
  if (!nav) return;
  if (user) {
    nav.innerHTML = `
      <a href="profil.html">Mon profil</a>
      <button type="button" class="link-button" data-logout>Déconnexion</button>`;
    nav.querySelector("[data-logout]").addEventListener("click", async () => {
      await supabase.auth.signOut();
      window.location.href = "index.html";
    });
  } else {
    nav.innerHTML = `<a href="connexion.html" class="button">Connexion</a>`;
  }
}

// Menu qui s'ouvre quand on clique sur « GamerStats » (en haut à gauche).
// Remplit l'élément [data-brand] présent dans le bandeau de chaque page.
// Pour un membre connecté, il contient aussi « Supprimer mon compte ».
export async function setupBrandMenu() {
  const root = document.querySelector("[data-brand]");
  if (!root) return;
  root.innerHTML = `
    <button type="button" class="logo" aria-haspopup="true" aria-expanded="false">
      Gamer<span>Stats</span><span class="caret">▾</span>
    </button>
    <div class="brand-dropdown" hidden>
      <a href="index.html">Accueil</a>
      <a href="profil.html">Mon profil</a>
      <hr>
      <a href="confidentialite.html" class="small">Politique de confidentialité</a>
      <button type="button" class="menu-danger" data-delete hidden>Supprimer mon compte</button>
    </div>`;
  const button = root.querySelector(".logo");
  const menu = root.querySelector(".brand-dropdown");
  const deleteItem = root.querySelector("[data-delete]");
  deleteItem.addEventListener("click", () => {
    setOpen(false);
    openDeleteDialog();
  });
  if (await currentUser()) deleteItem.hidden = false;
  const setOpen = (open) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
}

// Fenêtre de confirmation de la suppression du compte (créée au premier clic).
// Il faut taper « SUPPRIMER » pour activer le bouton.
function openDeleteDialog() {
  let dialog = document.getElementById("delete-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "delete-dialog";
    dialog.className = "game-dialog";
    dialog.setAttribute("aria-labelledby", "delete-title");
    dialog.innerHTML = `
      <div class="dialog-head">
        <h2 id="delete-title">Supprimer mon compte</h2>
        <button type="button" class="dialog-close" aria-label="Fermer">×</button>
      </div>
      <p>
        Ton compte sera <strong>définitivement supprimé</strong>, avec tes pseudos liés,
        ton historique, tes scores et ta place dans le classement. Cette action est irréversible.
      </p>
      <form>
        <label for="delete-confirm">Pour confirmer, tape <strong>SUPPRIMER</strong></label>
        <div class="form-row">
          <input id="delete-confirm" type="text" autocomplete="off" required>
          <button type="submit" class="button-danger" disabled>Supprimer définitivement</button>
        </div>
        <p class="message" role="status"></p>
      </form>`;
    document.body.append(dialog);

    const input = dialog.querySelector("input");
    const submit = dialog.querySelector("[type=submit]");
    const message = dialog.querySelector(".message");
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();  // clic sur le fond flouté
    });
    input.addEventListener("input", () => {
      submit.disabled = input.value.trim() !== "SUPPRIMER";
    });
    dialog.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        message.textContent = "La suppression a échoué, réessaie plus tard.";
        message.className = "message error";
        submit.disabled = false;
        return;
      }
      await supabase.auth.signOut();
      window.location.href = "index.html?compte=supprime";
    });
  }
  dialog.showModal();
}

// Pseudo déjà lié au compte pour un jeu (slug « chesscom », « wot »…), ou null.
export async function getLinkedUsername(userId, gameSlug) {
  const { data } = await supabase
    .from("game_accounts")
    .select("username, games!inner(slug)")
    .eq("user_id", userId)
    .eq("games.slug", gameSlug)
    .maybeSingle();
  return data?.username ?? null;
}

// Calcule les scores du membre connecté (tous ses jeux). Renvoie { rows, total }.
export async function computeScores() {
  const { data: rows, error } = await supabase.rpc("compute_my_scores");
  if (error) throw error;
  const { data: profile } = await supabase.from("profile_scores").select("total_score").maybeSingle();
  return { rows, total: profile?.total_score ?? 0 };
}

// Format des nombres à la française (1 856).
export const formatNumber = (n) => Math.round(n).toLocaleString("fr-FR");
