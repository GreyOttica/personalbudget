/** Vero se l'errore di Supabase indica una tabella o funzione non ancora creata (migrazione da eseguire). */
export function isMissingObject(error: { code?: string; message: string } | null | undefined): boolean {
  if (!error) return false;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) return true;
  return /does not exist|could not find the (table|function)/i.test(error.message);
}
