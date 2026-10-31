import { NextResponse, type NextRequest } from "next/server";
import { requireOwner } from "@/lib/auth";
import { runAnalysis } from "@/lib/ai/analyze";
import { aiInfo } from "@/lib/ai/client";

export const maxDuration = 120;

/** Genera un'analisi su richiesta (pulsante "Genera ora"). I job programmati arrivano con la Fase 5. */
export async function POST(request: NextRequest) {
  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const ai = aiInfo();
  if (!ai.configured) return NextResponse.json({ error: `Manca ${ai.keyName} su Vercel.` }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = body?.kind === "weekly" || body?.kind === "monthly" ? body.kind : "daily";
  const res = await runAnalysis(kind);
  return NextResponse.json(res, { status: res.ok ? 200 : 500 });
}
