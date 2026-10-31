import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Crea una categoria nuova dall'inserimento ("+ Nuova"). Se esiste già con quel nome, la restituisce. */
export async function POST(request: NextRequest) {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { name?: unknown; emoji?: unknown; kind?: unknown; isFixed?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const emoji = typeof body?.emoji === "string" && body.emoji.trim() ? [...body.emoji.trim()].slice(0, 4).join("") : "🏷️";
  const kind = body?.kind === "income" || body?.kind === "investment" ? body.kind : "expense";
  if (!name || name.length > 40) return NextResponse.json({ error: "Scrivi un nome (massimo 40 caratteri)." }, { status: 400 });

  const supabase = await createClient();
  const { data: existing } = await supabase.from("categories").select("id, name, emoji, kind, is_fixed").ilike("name", name).maybeSingle();
  if (existing) return NextResponse.json({ ...existing, uses: 0, existed: true });

  const { data: last } = await supabase.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase
    .from("categories")
    .insert({ name, emoji, kind, is_fixed: body?.isFixed === true, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id, name, emoji, kind, is_fixed")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ...data, uses: 0 });
}
