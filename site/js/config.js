// Connexion à Supabase pour le site.
// La clé "publishable" est faite pour être publique (elle est visible par tous
// les visiteurs) : la sécurité vient des règles RLS dans Supabase.
// Ne JAMAIS mettre ici la clé secrète (sb_secret_...).
export const SUPABASE_URL = "https://eyvgsketewzonacdpflc.supabase.co";
export const SUPABASE_KEY = "sb_publishable_8sluOPF0hLNa4J41-IWCvw_TpD6A7a9";

// Identifiant d'application Wargaming (type « Mobile ») : il identifie le site
// auprès de l'API publique de World of Tanks. Ce n'est pas un secret.
export const WG_APPLICATION_ID = "db5834b5c5ba011f545f5635282c34e3";
