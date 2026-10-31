import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { rememberAppUrl } from "@/lib/notify/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Body = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

async function owner() {
  try {
    await requireOwner();
    return true;
  } catch {
    return false;
  }
}

/** Salva il dispositivo che ha accettato le notifiche. */
export async function POST(request: NextRequest) {
  if (!(await owner())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const b = (await request.json().catch(() => null)) as Body | null;
  const endpoint = typeof b?.endpoint === "string" && b.endpoint.startsWith("https://") ? b.endpoint : null;
  const p256dh = typeof b?.keys?.p256dh === "string" ? b.keys.p256dh : null;
  const auth = typeof b?.keys?.auth === "string" ? b.keys.auth : null;
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "Iscrizione non valida" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ endpoint, p256dh, auth, user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await rememberAppUrl(createAdminClient(), request.nextUrl.origin);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!(await owner())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const b = (await request.json().catch(() => null)) as Body | null;
  if (typeof b?.endpoint !== "string") return NextResponse.json({ error: "Manca endpoint" }, { status: 400 });
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", b.endpoint);
  return NextResponse.json({ ok: true });
}
