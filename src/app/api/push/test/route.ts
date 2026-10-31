import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { sendPush } from "@/lib/notify/push";
import { createAdminClient } from "@/lib/supabase/admin";

/** Notifica di prova dalla pagina Impostazioni. */
export async function POST() {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const sent = await sendPush(createAdminClient(), {
    title: "🔔 Notifica di prova",
    body: "Funziona! Da qui arriveranno avvisi sul budget, promemoria e report.",
    url: "/impostazioni",
    tag: "test",
  });
  if (!sent) return NextResponse.json({ error: "Nessun dispositivo ha ricevuto la notifica. Riattiva le notifiche su questo telefono." }, { status: 404 });
  return NextResponse.json({ ok: true, sent });
}
