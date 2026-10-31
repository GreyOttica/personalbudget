import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { runChat } from "@/lib/ai/chat";
import { aiConfigured } from "@/lib/ai/client";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

async function guard() {
  try {
    await requireOwner();
    return null;
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  if (!aiConfigured()) return NextResponse.json({ error: "Manca ANTHROPIC_API_KEY su Vercel." }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 1000) return NextResponse.json({ error: "Scrivi una domanda (massimo 1000 caratteri)." }, { status: 400 });
  const res = await runChat(message);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}

/** Azzera la conversazione. */
export async function DELETE() {
  const denied = await guard();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("chat_messages").delete().gte("created_at", "1970-01-01");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
