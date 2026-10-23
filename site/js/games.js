// Liste des jeux affichés sur le profil. Pour ajouter un jeu : une entrée ici
// + un module qui exporte linkAndRefresh(userId, pseudo).
import * as chess from "./chess.js";
import * as wot from "./wot.js";

export const GAMES = [
  {
    slug: "chesscom",
    name: "Chess.com",           // doit être identique à games.name dans Supabase
    color: "#81b64c",
    icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="3.2"/><path d="M9 9.6h6l-1.1 6.2h-3.8z"/><path d="M6.5 21c0-2.6 2.3-4.3 5.5-4.3s5.5 1.7 5.5 4.3z"/></svg>`,
    ratingLabel: "Elo",
    inputLabel: "Ton pseudo Chess.com",
    placeholder: "ex. Pamplemous00",
    note: "Seul ton meilleur mode compte dans ton score total.",
    linkAndRefresh: chess.linkAndRefresh,
  },
  {
    slug: "wot",
    name: "World of Tanks",
    color: "#b0702a",
    icon: `<svg viewBox="0 0 24 24"><rect x="2.5" y="13" width="19" height="5.5" rx="2.75"/><path d="M5.5 12.5l1.6-3.3h7.6l1.6 3.3z"/><rect x="13.5" y="9.4" width="9" height="1.7" rx=".85"/></svg>`,
    ratingLabel: "WN8",
    inputLabel: "Ton pseudo World of Tanks (serveur Europe)",
    placeholder: "ex. Pamplemousse00",
    note: "WN8 en batailles aléatoires, calculé par GamerStats avec les statistiques officielles Wargaming et les valeurs attendues XVM (modxvm.com). Minimum 100 batailles.",
    linkAndRefresh: wot.linkAndRefresh,
  },
];
