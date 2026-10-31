import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { runTick } from "@/lib/notify/tick";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Chiamato da Supabase (pg_cron) ogni 15 minuti con il segreto salvato in app_config, o dal proprietario. */
async function authorized(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (token) {
    const { data } = await createAdminClient().from("app_config").select("cron_secret").eq("id", true).maybeSingle();
    const secret = data?.cron_secret ?? "";
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    return secret.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  }
  try {
    await requireOwner();
    return true;
  } catch {
    return false;
  }
}

async function handle(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  try {
    // Solo per i test automatici: simula un'altra ora (TICK_ALLOW_AT=1, mai impostata su Vercel).
    const at = process.env.TICK_ALLOW_AT === "1" && process.env.VERCEL_ENV !== "production" ? request.nextUrl.searchParams.get("at") : null;
    return NextResponse.json(await runTick(at ? new Date(at) : new Date()));
  } catch (e) {
    console.error("tick:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Solo POST: un link aperto per sbaglio (GET) non deve far partire analisi, backup o notifiche.
export const POST = handle;
