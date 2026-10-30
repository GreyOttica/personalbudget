// Variabili d'ambiente lette in un solo punto, con errori chiari se mancano.

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return value;
}

// Le NEXT_PUBLIC_* vanno lette con accesso statico, altrimenti Next.js non le
// incorpora nel bundle del browser.
// Accetta anche l'URL copiato con "/rest/v1/" o una barra finale.
export const supabaseUrl = () =>
  required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL)
    .trim()
    .replace(/\/(rest|auth)\/v1\/?$/, "")
    .replace(/\/+$/, "");

export const supabasePublishableKey = () =>
  required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/** Email dell'unico utente ammesso. Solo lato server. */
export const ownerEmail = () => required("OWNER_EMAIL", process.env.OWNER_EMAIL).trim().toLowerCase();

/** Secret key (bypassa RLS). Solo lato server. */
export const supabaseSecretKey = () => required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
