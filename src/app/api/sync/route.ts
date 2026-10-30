import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { ops?: unknown } | null;
  if (!body || !Array.isArray(body.ops) || body.ops.length > 500) {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  const supabase = await createClient();
  // La funzione gira con la sessione dell'utente: RLS ammette solo il proprietario.
  const { data, error } = await supabase.rpc("apply_transaction_ops", { p_ops: body.ops });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
