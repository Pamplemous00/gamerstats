// Client Supabase partagé par toutes les pages, et petits outils communs.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// « Rester connecté » : la session est gardée dans le stockage durable du navigateur
// (localStorage, elle survit à la fermeture du navigateur) ou, si la case a été
// décochée, dans le stockage de l'onglet (sessionStorage, effacé à la fermeture).
const REMEMBER_KEY = "gamerstats-rester-connecte";

function safe(action) {
  try { return action(); } catch { return null; }
}

function remember() {
  return safe(() => localStorage.getItem(REMEMBER_KEY)) !== "non";
}

const sessionStore = {
  getItem: (key) => safe(() => localStorage.getItem(key) ?? sessionStorage.getItem(key)),
  setItem: (key, value) => safe(() => {
    const [keep, drop] = remember() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
    keep.setItem(key, value);
    drop.removeItem(key);
  }),
  removeItem: (key) => safe(() => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }),
};

// À appeler juste avant de se connecter, selon la case « Rester connecté ».
export function setRemember(value) {
  safe(() => localStorage.setItem(REMEMBER_KEY, value ? "oui" : "non"));
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: sessionStore, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

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
// Pour un membre connecté, il contient aussi « Paramètres » et « Supprimer mon compte ».
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
      <button type="button" class="menu-item" data-settings hidden>Paramètres</button>
      <hr>
      <a href="confidentialite.html" class="small">Politique de confidentialité</a>
      <button type="button" class="menu-danger" data-delete hidden>Supprimer mon compte</button>
    </div>`;
  const button = root.querySelector(".logo");
  const menu = root.querySelector(".brand-dropdown");
  const settingsItem = root.querySelector("[data-settings]");
  const deleteItem = root.querySelector("[data-delete]");
  settingsItem.addEventListener("click", () => {
    setOpen(false);
    openNameDialog();
  });
  deleteItem.addEventListener("click", () => {
    setOpen(false);
    openDeleteDialog();
  });
  if (await currentUser()) {
    settingsItem.hidden = false;
    deleteItem.hidden = false;
  }
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

// ===== Pseudo (nom affiché dans le classement) =====
// Mêmes règles que dans Supabase (display_name.sql).
const NAME_RULE = /^[A-Za-z0-9_.-]{3,20}$/;

// Pseudo du membre connecté, ou null s'il n'en a pas encore choisi.
export async function getDisplayName() {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("display_name").eq("id", user.id).maybeSingle();
  return data?.display_name ?? null;
}

// Enregistre le pseudo. Renvoie un message d'erreur, ou null si tout va bien.
async function saveDisplayName(name) {
  if (!NAME_RULE.test(name)) {
    return "3 à 20 caractères : lettres sans accent, chiffres, « _ », « . » ou « - » (pas d'espace).";
  }
  const user = await currentUser();
  const { error } = await supabase.from("users").update({ display_name: name }).eq("id", user.id);
  if (error?.code === "23505") return "Ce pseudo est déjà pris, choisis-en un autre.";
  if (error) return "Enregistrement impossible pour le moment, réessaie plus tard.";
  // Prévient la page (bandeau, classement) que le pseudo a changé.
  document.dispatchEvent(new CustomEvent("gamerstats:pseudo", { detail: name }));
  return null;
}

// Fenêtre « Choisis ton pseudo » / « Paramètres ».
// required = true : première connexion, impossible de fermer sans choisir.
export async function openNameDialog({ required = false } = {}) {
  let dialog = document.getElementById("name-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "name-dialog";
    dialog.className = "game-dialog";
    dialog.setAttribute("aria-labelledby", "name-title");
    dialog.innerHTML = `
      <div class="dialog-head">
        <h2 id="name-title"></h2>
        <button type="button" class="dialog-close" aria-label="Fermer">×</button>
      </div>
      <p class="muted" data-intro></p>
      <form>
        <label for="name-input">Pseudo</label>
        <div class="form-row">
          <input id="name-input" type="text" required minlength="3" maxlength="20"
                 pattern="[A-Za-z0-9_.\\-]{3,20}" autocomplete="nickname">
          <button type="submit">Enregistrer</button>
        </div>
        <p class="muted small-print">3 à 20 caractères : lettres sans accent, chiffres, « _ », « . » ou « - ».</p>
        <p class="message" role="status"></p>
      </form>`;
    document.body.append(dialog);

    const input = dialog.querySelector("input");
    const submit = dialog.querySelector("[type=submit]");
    const message = dialog.querySelector(".message");
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && !dialog.dataset.required) dialog.close();
    });
    // Échap ne ferme pas la fenêtre quand le pseudo est obligatoire.
    // (Chrome autorise parfois quand même la fermeture : on la rouvre alors aussitôt.)
    dialog.addEventListener("cancel", (event) => {
      if (dialog.dataset.required) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
      if (dialog.dataset.required) dialog.showModal();
    });
    dialog.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const error = await saveDisplayName(input.value.trim());
      submit.disabled = false;
      if (error) {
        message.textContent = error;
        message.className = "message error";
        return;
      }
      message.textContent = "";
      delete dialog.dataset.required;
      dialog.close();
    });
  }

  if (required) dialog.dataset.required = "oui";
  else delete dialog.dataset.required;
  dialog.querySelector("#name-title").textContent = required ? "Choisis ton pseudo" : "Paramètres";
  dialog.querySelector("[data-intro]").textContent = required
    ? "Bienvenue ! Ton pseudo est le nom affiché dans le classement. Tu pourras le changer plus tard dans les Paramètres (menu GamerStats)."
    : "Ton pseudo est le nom affiché dans le classement.";
  dialog.querySelector(".dialog-close").hidden = required;
  dialog.querySelector(".message").textContent = "";
  dialog.querySelector("input").value = (await getDisplayName()) ?? "";
  dialog.showModal();
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
