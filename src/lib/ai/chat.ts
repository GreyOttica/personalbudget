import "server-only";
import { z } from "zod";
import { addMonths, monthOf } from "@/lib/analytics/dashboard";
import { categoryTrends, recurring, smallSpends } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { costUsd } from "./client";
import { toolChat, type ChatTurn, type ToolDef } from "./llm";
import { dashboardFor, monthFacts, projection, type FactsInput } from "./facts";
import { buildProposal, type ProposalItem, type ProposalSummary } from "@/lib/analytics/proposal";
import { CHAT_SYSTEM } from "./prompts";
import { isMissingObject } from "@/lib/supabase/missing";

const HISTORY = 12; // messaggi precedenti inviati all'AI: abbastanza per il contesto, pochi token
const eur = (c: number) => Math.round(c / 100);
/** Strumento tipizzato: l'input arriva già validato dallo schema. */
function tool<S extends z.ZodObject>(def: { name: string; description: string; inputSchema: S; run: (input: z.infer<S>) => Promise<string> }): ToolDef {
  return { name: def.name, description: def.description, schema: def.inputSchema, run: (input) => def.run(input as z.infer<S>) };
}

const MONTH = z.string().regex(/^\d{4}-\d{2}$/).describe("Mese nel formato AAAA-MM");

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; question: string; proposalId: string | null };

function tools(input: FactsInput, ctx: Ctx): ToolDef[] {
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
      description: "Riepilogo di un mese: entrate, spese (fisse e variabili), investito, risparmio, budget e categorie con media. Per il mese in corso anche la previsione statistica: stime con forchetta, probabilità di sforare, risparmio probabile, quota di spesa di oggi e ritmo.",
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
      name: "budget_attuali",
      description:
        "Budget mensili attuali per categoria di spesa, con media degli ultimi mesi, mese scorso, speso e stima di fine mese in corso, più media entrate e risparmio. Da leggere prima di proporre nuovi budget.",
      inputSchema: z.object({}),
      run: async () => {
        const d = dashboardFor(input, current);
        const last = dashboardFor(input, addMonths(current, -1));
        const lastBy = new Map(last.categories.map((c) => [c.id, c.spent]));
        return json({
          media_entrate_mensili: eur(d.averages.income),
          media_spese_mensili: eur(d.averages.expense),
          media_risparmio_pct: d.averages.savingsRate === null ? null : Math.round(d.averages.savingsRate * 1000) / 10,
          mesi_di_storia: d.averages.months,
          budget_totale: eur(d.budget.total),
          categorie: input.categories
            .filter((c) => c.kind === "expense")
            .map((c) => {
              const r = d.categories.find((x) => x.id === c.id);
              return {
                nome: c.name,
                fissa: c.is_fixed || undefined,
                budget: r?.budget == null ? null : eur(r.budget),
                media_mensile: eur(r?.average ?? 0),
                mese_scorso: eur(lastBy.get(c.id) ?? 0),
                speso_mese_in_corso: eur(r?.spent ?? 0),
                stima_fine_mese: r?.forecast == null ? undefined : eur(r.forecast),
              };
            })
            .filter((c) => c.budget !== null || c.media_mensile > 0 || c.speso_mese_in_corso > 0),
        });
      },
    }),
    tool({
      name: "proponi_budget",
      description:
        "Prepara una proposta di nuovi budget mensili (solo le categorie da cambiare; euro interi, 0 = togli il budget). Calcola totale, spesa prevista e risparmio mensile previsto, con avvisi. L'utente la applica con un pulsante: non è ancora attiva.",
      inputSchema: z.object({
        categorie: z.array(z.object({ nome: z.string(), euro: z.number().int().min(0).max(100000) })).min(1).max(30),
        motivo: z.string().max(300).optional().describe("Obiettivo della proposta in poche parole"),
      }),
      run: async ({ categorie, motivo }) => {
        const unknown: string[] = [];
        const changes: { categoryId: string; cents: number }[] = [];
        for (const x of categorie) {
          const c = findCategory(x.nome);
          if (!c || c.kind !== "expense") unknown.push(x.nome);
          else changes.push({ categoryId: c.id, cents: x.euro * 100 });
        }
        if (!changes.length) return json({ errore: "Nessuna categoria riconosciuta", sconosciute: unknown });
        const d = dashboardFor(input, current);
        const p = buildProposal(d, input.categories, changes);
        if (!p.items.length) return json({ errore: "La proposta non cambia nessun budget rispetto a quelli attuali." });
        const { data, error } = await ctx.supabase
          .from("budget_proposals")
          .insert({ request: (motivo ?? ctx.question).slice(0, 300), items: p.items, summary: p.summary })
          .select("id")
          .single();
        if (error) return json({ errore: isMissingObject(error) ? "Manca la migrazione 0007 su Supabase" : error.message });
        ctx.proposalId = data.id;
        return json({
          proposta_salvata: true,
          modifiche: p.items.map((i) => ({ categoria: i.name, da: i.from_cents === null ? null : eur(i.from_cents), a: eur(i.to_cents), media: eur(i.average_cents) })),
          ...p.summary,
          categorie_non_trovate: unknown.length ? unknown : undefined,
        });
      },
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

export type Proposal = { id: string; items: ProposalItem[]; summary: ProposalSummary; applied_at: string | null };

export type ChatResult = { ok: true; answer: string; toolsUsed: string[]; costUsd: number; proposal: Proposal | null } | { ok: false; error: string };

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

  const askedAt = new Date();
  const ctx: Ctx = { supabase, question, proposalId: null };
  const res = await toolChat(CHAT_SYSTEM.replace("{OGGI}", today), turns, tools({ ...all, today }, ctx));
  if (!res.ok) return res;
  const { usage, model } = res;
  const answer = res.value.text;
  const toolsUsed = res.value.toolsUsed;

  const cost = costUsd(usage, model);
  const { error } = await supabase.from("chat_messages").insert([
    // Righe con le stesse colonne: in un insert multiplo PostgREST mette NULL nelle colonne mancanti.
    { role: "user", content: question, created_at: askedAt.toISOString(), tools_used: [], model: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0, ...(ctx.proposalId ? { proposal_id: null } : {}) },
    {
      role: "assistant",
      content: answer,
      created_at: new Date(askedAt.getTime() + 1).toISOString(), // dopo la domanda, anche nello stesso millisecondo
      tools_used: toolsUsed,
      model,
      input_tokens: usage.input + usage.cacheWrite,
      output_tokens: usage.output,
      cache_read_tokens: usage.cacheRead,
      cost_usd: cost,
      ...(ctx.proposalId ? { proposal_id: ctx.proposalId } : {}),
    },
  ]);
  if (error) return { ok: false, error: error.message };
  let proposal: Proposal | null = null;
  if (ctx.proposalId) {
    const { data } = await supabase.from("budget_proposals").select("id, items, summary, applied_at").eq("id", ctx.proposalId).single();
    proposal = (data as Proposal | null) ?? null;
  }
  return { ok: true, answer, toolsUsed, costUsd: cost, proposal };
}
