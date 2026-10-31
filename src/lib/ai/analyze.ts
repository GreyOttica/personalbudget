import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { addUsage, anthropic, costUsd, emptyUsage, FALLBACK, MODEL } from "./client";
import { factNumbers, factsFor, unknownNumbers, type AnalysisKind } from "./facts";
import { ANALYSIS_SYSTEM } from "./prompts";
import { isMissingObject } from "@/lib/supabase/missing";

const AnalysisSchema = z.object({
  titolo: z.string(),
  sintesi: z.string(),
  punti: z.array(z.object({ titolo: z.string(), testo: z.string() })),
  consigli: z.array(z.object({ leva: z.string(), titolo: z.string(), azione: z.string() })),
  dati_insufficienti: z.string().nullable(),
});

export type AnalysisContent = {
  sintesi: string;
  punti: { titolo: string; testo: string }[];
  consigli: { leva: string; titolo: string; azione: string; euro_mese: number; euro_anno: number; base: string }[];
  dati_insufficienti: string | null;
  verifica: { numeri_non_trovati: number[] };
};

export type AnalysisResult =
  | { ok: true; id: string; kind: AnalysisKind; headline: string; costUsd: number }
  | { ok: false; error: string };

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Genera e salva l'analisi del tipo richiesto. Rigenerarla per lo stesso periodo la sostituisce.
 * `client`: sessione dell'utente (pulsante) oppure client con secret key (job programmato).
 */
export async function runAnalysis(kind: AnalysisKind, client?: Client, today = romeDate()): Promise<AnalysisResult> {
  const supabase = client ?? (await createClient());
  const all = await loadAll(supabase);
  const { facts, levers, period } = factsFor(kind, { ...all, today });
  if (all.txns.length === 0) return { ok: false, error: "Non ci sono ancora movimenti da analizzare." };

  let response;
  try {
    response = await anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      ...FALLBACK,
      output_config: { effort: "medium", format: betaZodOutputFormat(AnalysisSchema) },
      system: ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `FATTI:\n${JSON.stringify(facts)}` }],
    });
  } catch (e) {
    return { ok: false, error: `Chiamata all'AI non riuscita: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (response.stop_reason === "refusal") return { ok: false, error: "L'AI ha rifiutato la richiesta. Riprova più tardi." };
  const out = response.parsed_output;
  if (!out) return { ok: false, error: `Risposta dell'AI non valida (${response.stop_reason}).` };

  // Impatto dei consigli: lo mette il codice dalla leva scelta, poi ordino per impatto.
  const byId = new Map(levers.map((l) => [l.id, l]));
  const consigli = out.consigli
    .map((c) => ({ c, l: byId.get(c.leva.trim()) }))
    .filter((x): x is { c: (typeof out.consigli)[number]; l: NonNullable<typeof x.l> } => !!x.l)
    .slice(0, 3)
    .map(({ c, l }) => ({ leva: l.id, titolo: c.titolo, azione: c.azione, euro_mese: l.euro_mese, euro_anno: l.euro_anno, base: l.base }))
    .sort((a, b) => b.euro_mese - a.euro_mese);

  const known = factNumbers(facts);
  const text = [out.titolo, out.sintesi, ...out.punti.flatMap((p) => [p.titolo, p.testo]), ...consigli.flatMap((c) => [c.titolo, c.azione])].join("\n");
  const content: AnalysisContent = {
    sintesi: out.sintesi,
    punti: out.punti.slice(0, 4),
    consigli,
    dati_insufficienti: out.dati_insufficienti,
    verifica: { numeri_non_trovati: [...new Set(unknownNumbers(text, known))] },
  };
  const usage = addUsage(emptyUsage(), response.usage);
  const cost = costUsd(usage, response.model);
  const headline = out.titolo.length > 140 ? `${out.titolo.slice(0, 137)}…` : out.titolo;

  const { data, error } = await supabase
    .from("analyses")
    .upsert(
      {
        kind,
        period_start: period.start,
        period_end: period.end,
        headline,
        content,
        facts,
        model: response.model,
        input_tokens: usage.input + usage.cacheWrite,
        output_tokens: usage.output,
        cache_read_tokens: usage.cacheRead,
        cost_usd: cost,
        created_at: new Date().toISOString(),
      },
      { onConflict: "kind,period_start" },
    )
    .select("id")
    .single();
  if (error) {
    const missing = isMissingObject(error);
    return { ok: false, error: missing ? "Esegui prima su Supabase la migrazione 20261101000006_ai.sql." : error.message };
  }
  return { ok: true, id: data.id, kind, headline, costUsd: cost };
}
