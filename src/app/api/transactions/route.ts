import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Movimenti tenuti sul telefono per l'elenco, i filtri e l'uso offline (circa 1 MB ogni 5.000).
const LIMIT = 5000;

export async function GET() {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const supabase = await createClient();
  // Supabase restituisce al massimo 1000 righe per richiesta: leggo a pagine.
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < LIMIT; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, tag, updated_at")
      .is("deleted_at", null)
      .neq("type", "opening_balance")
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, Math.min(from + 999, LIMIT - 1));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json(
    rows.map((t) => ({ ...t, amount_cents: Number(t.amount_cents) })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
