import "server-only";
import { ownerEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Da chiamare all'inizio di ogni server action o route che usa la secret key.
 * src/proxy.ts protegge già le pagine, ma le action vanno verificate da sole.
 */
export async function requireOwner(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : null;
  if (!email || email !== ownerEmail()) throw new Error("Non autorizzato");
  return email;
}
