// Liste des jeux affichés sur le profil. Pour ajouter un jeu : une entrée ici
// + un module qui exporte linkAndRefresh(userId, pseudo).
// image : illustration de la carte (sinon l'icône SVG est utilisée en grand).
// modeLabel : nom affiché du mode pour un jeu qui n'en a qu'un.
import * as chess from "./chess.js";
import * as wot from "./wot.js";
import * as lichess from "./lichess.js";

// Jeux prévus mais pas encore branchés : tuiles grisées « Bientôt » dans le panneau du bas.
// Logos : sites officiels des jeux ou projet Simple Icons (v13.21.0), affichés en gris.
// Sans image : le nom du jeu est écrit à la place. Quand un jeu est branché,
// le retirer d'ici et l'ajouter à GAMES.
const soon = (name, file) => ({ name, image: file ? `img/bientot/${file}` : null });
export const COMING_SOON = [
  soon("World of Warships", "worldofwarships.svg"),
  soon("World of Tanks Blitz", "wotblitz.svg"),
  soon("Dota 2", "dota2.svg"),
  soon("Counter-Strike 2", "counterstrike.svg"),
  soon("Age of Empires IV", "ageofempires.webp"),
  soon("Age of Empires II", "ageofempires.webp"),
  soon("Pokémon Showdown", "pokemon.svg"),
  soon("TETR.IO", "tetrio.png"),
  soon("Go (OGS)", "ogs.png"),
  soon("Overwatch 2", "overwatch.png"),
  soon("TypeRacer", "typeracer.png"),
  soon("osu!", "osu.svg"),
  soon("Apex Legends"),
  soon("Clash Royale", "clashroyale.webp"),
  soon("Brawl Stars"),
  soon("Clash of Clans", "clashofclans.webp"),
  soon("PUBG", "pubg.svg"),
  soon("StarCraft II"),
  soon("Hypixel", "hypixel.png"),
  soon("Monkeytype", "monkeytype.svg"),
  soon("League of Legends", "leagueoflegends.svg"),
  soon("Teamfight Tactics", "tft.svg"),
  soon("Valorant", "valorant.svg"),
  soon("Marvel Rivals", "marvelrivals.png"),
  soon("Trackmania", "trackmania.png"),
  soon("Brawlhalla", "brawlhalla.png"),
  soon("GeoGuessr", "geoguessr.svg"),
  soon("Rocket League"),
];

export const GAMES = [
  {
    slug: "chesscom",
    name: "Chess.com",           // doit être identique à games.name dans Supabase
    color: "#81b64c",
    image: "img/chesscom-pawn.png",  // pion officiel (Chess.com Brand Resources)
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
    image: "img/wot-logo.svg",  // logo officiel (site de Wargaming)
    icon: `<svg viewBox="0 0 24 24"><rect x="2.5" y="13" width="19" height="5.5" rx="2.75"/><path d="M5.5 12.5l1.6-3.3h7.6l1.6 3.3z"/><rect x="13.5" y="9.4" width="9" height="1.7" rx=".85"/></svg>`,
    ratingLabel: "WN8",
    modeLabel: "Aléatoires",
    inputLabel: "Ton pseudo World of Tanks (serveur Europe)",
    placeholder: "ex. Pamplemousse00",
    note: "WN8 en batailles aléatoires, calculé par GamerStats avec les statistiques officielles Wargaming et les valeurs attendues XVM (modxvm.com). Minimum 100 batailles.",
    linkAndRefresh: wot.linkAndRefresh,
  },
  {
    slug: "lichess",
    name: "Lichess",
    color: "#b58863",
    image: "img/lichess.svg",  // logo Lichess (Simple Icons), en blanc
    icon: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>`,
    ratingLabel: "Elo",
    inputLabel: "Ton pseudo Lichess",
    placeholder: "ex. DrNykterstein",
    note: "Top % calculé sur tous les joueurs actifs de la semaine (statistiques officielles Lichess). Seuls les classements établis comptent, pas ceux marqués « ? ». Seul ton meilleur mode compte dans ton score total.",
    linkAndRefresh: lichess.linkAndRefresh,
  },
];
