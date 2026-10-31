import "server-only";
import { z } from "zod";
import { addMonths, monthOf } from "@/lib/analytics/dashboard";
import { categoryTrends, recurring, smallSpends } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { costUsd } from "./client";
import { toolChat, type ChatTurn, type ToolDef } from "./llm";
import { monthFacts, projection, type FactsInput } from "./facts";
import { CHAT_SYSTEM } from "./prompts";
import { isMissingObject } from "@/lib/supabase/missing";

const HISTORY = 12; // messaggi precedenti inviati all'AI: abbastanza per il contesto, pochi token
const eur = (c: number) => Math.round(c / 100);
/** Strumento tipizzato: l'input arriva già validato dallo schema. */
function tool<S extends z.ZodObject>(def: { name: string; description: string; inputSchema: S; run: (input: z.infer<S>) => Promise<string> }): ToolDef {
  return { name: def.name, description: def.description, schema: def.inputSchema, run: (input) => def.run(input as z.infer<S>) };
}

const MONTH = z.string().regex(/^\d{4}-\d{2}$/).describe("Mese nel formato AAAA-MM");

function tools(input: FactsInput): ToolDef[] {
  const current = monthOf(input.today);
  const cat = new Map(input.categories.map((c) => [c.id, c]));
  const sub = new Map(input.subcategories.map((s) => [s.id, s]));
  const findCategory = (name: string) => {
    const n = name.trim().toLowerCase();
    return input.categories.find((c) => c.name.toLowerCase() === n) ?? input.categories.find((c) => c.name.toLowerCase().includes(n));
  };
  const json = (v: unknown) => JSON.stringify(v, (_k, val) => (val === undefined ? undefined : val));
  const strip = (m: ReturnType<typeof monthFacts>) => {
    const { _d, ...rest } = m;
    void _d;
    return rest;
  };

  return [
    tool({
      name: "riepilogo_mese",
      description: "Riepilogo di un mese: entrate, spese (fisse e variabili), investito, risparmio, stima di fine mese se in corso, budget e categorie con media.",
      inputSchema: z.object({ mese: MONTH.optional().describe("Default: mese in corso") }),
      run: async ({ mese }) => json(strip(monthFacts(input, mese && mese <= current ? mese : current))),
    }),
    tool({
      name: "andamento",
      description: "Entrate, spese, investito e percentuale di risparmio mese per mese.",
      inputSchema: z.object({ mesi: z.number().int().min(1).max(24).optional().describe("Quanti mesi indietro, default 6") }),
      run: async ({ mesi }) => {
        const n = mesi ?? 6;
        const months = Array.from({ length: n }, (_, i) => addMonths(current, -(n - 1 - i)));
        return json(
          months.map((m) => {
            const f = monthFacts(input, m);
            return { mese: f.mese, entrate: f.entrate, spese: f.spese, investito: f.investito, risparmio_pct: f.risparmio_pct };
          }),
        );
      },
    }),
    tool({
      name: "categoria",
      description: "Una categoria di spesa: importo mese per mese negli ultimi 12 mesi, media, e sottocategorie del mese in corso.",
      inputSchema: z.object({ nome: z.string().describe("Nome della categoria, per esempio Supermercato") }),
      run: async ({ nome }) => {
        const c = findCategory(nome);
        if (!c) return json({ errore: "Categoria non trovata", categorie: input.categories.map((x) => x.name) });
        const t = categoryTrends(input.txns, input.categories, current).find((x) => x.id === c.id);
        const subs = new Map<string, number>();
        for (const x of input.txns) {
          if (x.type !== "expense" || x.category_id !== c.id || monthOf(x.occurred_on) !== current) continue;
          const k = x.subcategory_id ? (sub.get(x.subcategory_id)?.name ?? "?") : "senza sottocategoria";
          subs.set(k, (subs.get(k) ?? 0) + x.amount_cents);
        }
        return json({
          categoria: c.name,
          fissa: c.is_fixed || undefined,
          mesi: t?.values.map((v) => ({ mese: v.month, euro: eur(v.amount) })) ?? [],
          media_mensile_mesi_precedenti: t ? eur(t.average) : 0,
          sottocategorie_mese_in_corso: [...subs].map(([nome, v]) => ({ nome, euro: eur(v) })).sort((a, b) => b.euro - a.euro),
        });
      },
    }),
    tool({
      name: "cerca_movimenti",
      description: "Cerca movimenti per periodo, categoria, testo nella nota o sottocategoria, tipo e importo minimo. Restituisce totale, numero e fino a 40 righe.",
      inputSchema: z.object({
        dal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        al: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        categoria: z.string().optional(),
        testo: z.string().optional(),
        tipo: z.enum(["uscita", "entrata", "investimento"]).optional(),
        min_euro: z.number().optional(),
      }),
      run: async (q) => {
        const c = q.categoria ? findCategory(q.categoria) : undefined;
        const type = q.tipo === "entrata" ? "income" : q.tipo === "investimento" ? "investment" : q.tipo === "uscita" ? "expense" : undefined;
        const text = q.testo?.toLowerCase();
        const rows = input.txns
          .filter((t) => t.type !== "opening_balance")
          .filter((t) => (!q.dal || t.occurred_on >= q.dal) && (!q.al || t.occurred_on <= q.al))
          .filter((t) => !c || t.category_id === c.id)
          .filter((t) => !type || t.type === type)
          .filter((t) => q.min_euro === undefined || t.amount_cents >= q.min_euro * 100)
          .filter((t) => !text || [t.note, t.subcategory_id ? sub.get(t.subcategory_id)?.name : null, t.tag].some((v) => v?.toLowerCase().includes(text)))
          .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
        return json({
          trovati: rows.length,
          totale_euro: eur(rows.reduce((s, t) => s + t.amount_cents, 0)),
          righe: rows.slice(0, 40).map((t) => ({
            data: t.occurred_on,
            tipo: t.type === "expense" ? undefined : t.type,
            categoria: cat.get(t.category_id)?.name,
            sottocategoria: t.subcategory_id ? sub.get(t.subcategory_id)?.name : undefined,
            euro: Math.round(t.amount_cents) / 100,
            nota: t.note ?? undefined,
            tag: t.tag ?? undefined,
          })),
        });
      },
    }),
    tool({
      name: "proiezione",
      description:
        "Saldo previsto del conto a fine di un mese futuro, dal risparmio netto medio dei mesi completi. Con 'spesa_euro' calcola quanto resterebbe dopo quella spesa. Usalo per ogni domanda tipo 'posso permettermi…'.",
      inputSchema: z.object({ fino_al_mese: MONTH, spesa_euro: z.number().positive().optional() }),
      run: async ({ fino_al_mese, spesa_euro }) => json(projection(input, fino_al_mese < current ? current : fino_al_mese, spesa_euro)),
    }),
    tool({
      name: "ricorrenti_e_obiettivi",
      description: "Spese ricorrenti (automatiche e riconosciute nello storico) e obiettivi di risparmio con quanto manca.",
      inputSchema: z.object({}),
      run: async () =>
        json({
          automatici: input.rules.filter((r) => r.active).map((r) => ({ nome: r.name, euro: eur(r.amount_cents), giorno: r.day_of_month, tipo: r.type })),
          riconosciuti: recurring(input.txns, input.categories, input.subcategories, input.today).map((r) => ({ nome: r.name, euro: eur(r.typical), anno: eur(r.yearly) })),
          obiettivi: input.goals.map((g) => ({ nome: g.name, obiettivo: eur(g.target_cents), messi_da_parte: eur(g.saved_cents), entro: g.target_date ?? undefined })),
        }),
    }),
    tool({
      name: "piccole_spese",
      description: "Piccole spese ripetute (fino a 10 €, almeno 3 volte nel mese) con stima annuale.",
      inputSchema: z.object({ mese: MONTH.optional() }),
      run: async ({ mese }) => {
        const s = smallSpends(input.txns, input.categories, input.subcategories, mese ?? current);
        return json({
          totale_mese: eur(s.total),
          voci: s.items.map((i) => ({ nome: i.name, volte: i.count, mese: eur(i.total), media_mese: eur(i.monthlyAverage), anno: eur(i.yearly) })),
        });
      },
    }),
  ];
}

export type ChatResult = { ok: true; answer: string; toolsUsed: string[]; costUsd: number } | { ok: false; error: string };

export async function runChat(question: string): Promise<ChatResult> {
  const supabase = await createClient();
  const today = romeDate();
  const [all, history] = await Promise.all([
    loadAll(supabase),
    supabase.from("chat_messages").select("role, content").order("created_at", { ascending: false }).limit(HISTORY),
  ]);
  if (history.error) {
    const missing = isMissingObject(history.error);
    return { ok: false, error: missing ? "Esegui prima su Supabase la migrazione 20261101000006_ai.sql." : history.error.message };
  }
  const turns: ChatTurn[] = [
    ...(history.data ?? []).reverse().map((m) => ({ role: m.role as ChatTurn["role"], content: m.content as string })),
    { role: "user", content: question },
  ];
  // La conversazione deve iniziare con l'utente: tolgo eventuali risposte rimaste in testa.
  while (turns.length && turns[0].role !== "user") turns.shift();

  const res = await toolChat(CHAT_SYSTEM.replace("{OGGI}", today), turns, tools({ ...all, today }));
  if (!res.ok) return res;
  const { usage, model } = res;
  const answer = res.value.text;
  const toolsUsed = res.value.toolsUsed;

  const cost = costUsd(usage, model);
  const { error } = await supabase.from("chat_messages").insert([
    // Righe con le stesse colonne: in un insert multiplo PostgREST mette NULL nelle colonne mancanti.
    { role: "user", content: question, tools_used: [], model: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0 },
    {
      role: "assistant",
      content: answer,
      tools_used: toolsUsed,
      model,
      input_tokens: usage.input + usage.cacheWrite,
      output_tokens: usage.output,
      cache_read_tokens: usage.cacheRead,
      cost_usd: cost,
    },
  ]);
  if (error) return { ok: false, error: error.message };
  return { ok: true, answer, toolsUsed, costUsd: cost };
}
