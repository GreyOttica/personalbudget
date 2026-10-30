import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Movimenti tenuti sul telefono per l'elenco e l'uso offline.
const LIMIT = 300;

export async function GET() {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("id, occurred_on, type, amount_cents, category_id, subcategory_id, account_id, note, tag, updated_at")
    .is("deleted_at", null)
    .neq("type", "opening_balance")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    (data ?? []).map((t) => ({ ...t, amount_cents: Number(t.amount_cents) })),
    { headers: { "Cache-Control": "no-store" } },
  );
}
