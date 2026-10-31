import "server-only";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import type { AnalyticsCategory, AnalyticsSubcategory, BudgetRow } from "./dashboard";
import type { Checkpoint, InsightTxn, RecurringRule } from "./insights";

// PostgREST restituisce al massimo 1000 righe per richiesta: leggo a pagine.
async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Crea i movimenti dei ricorrenti automatici dovuti fino a oggi (idempotente).
 * Se la migrazione dei ricorrenti non è ancora stata eseguita, non fa nulla.
 */
export async function generateRecurring(supabase: Client) {
  const { error } = await supabase.rpc("generate_recurring", { p_today: romeDate() });
  if (error && !/generate_recurring|does not exist|schema cache/i.test(error.message)) console.error("generate_recurring:", error.message);
}

/** Come fetchAll, ma una tabella non ancora creata (migrazione da eseguire) vale come vuota. */
async function fetchOptional<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  try {
    return await fetchAll(query);
  } catch {
    return [] as T[];
  }
}

/** Tutto lo storico (qualche migliaio di righe al massimo): base per le pagine di analisi. */
export async function loadAll() {
  const supabase = await createClient();
  await generateRecurring(supabase);
  const [categories, subcategories, budgets, txns, rules, checkpoints] = await Promise.all([
    fetchAll<AnalyticsCategory>((a, b) => supabase.from("categories").select("id, name, emoji, kind, is_fixed").order("sort_order").range(a, b)),
    fetchAll<AnalyticsSubcategory>((a, b) => supabase.from("subcategories").select("id, category_id, name").range(a, b)),
    fetchAll<BudgetRow>((a, b) => supabase.from("budgets").select("category_id, valid_from, amount_cents").range(a, b)),
    fetchAll<InsightTxn>((a, b) =>
      supabase
        .from("transactions")
        .select("id, occurred_on, type, amount_cents, category_id, subcategory_id, note, tag")
        .is("deleted_at", null)
        .order("occurred_on")
        .order("id")
        .range(a, b),
    ),
    fetchOptional<RecurringRule>((a, b) =>
      supabase
        .from("recurring_rules")
        .select("id, name, type, amount_cents, category_id, subcategory_id, account_id, note, day_of_month, starts_on, active")
        .order("created_at")
        .range(a, b),
    ),
    fetchOptional<Checkpoint & { id: string }>((a, b) => supabase.from("balance_checkpoints").select("id, as_of, balance_cents").order("as_of").range(a, b)),
  ]);
  return {
    categories,
    subcategories,
    budgets: budgets.map((b) => ({ ...b, amount_cents: Number(b.amount_cents) })),
    txns: txns.map((t) => ({ ...t, amount_cents: Number(t.amount_cents) })),
    rules: rules.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) })),
    checkpoints: checkpoints.map((c) => ({ ...c, balance_cents: Number(c.balance_cents) })),
  };
}
