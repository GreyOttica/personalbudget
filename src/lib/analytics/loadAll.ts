import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AnalyticsCategory, AnalyticsSubcategory, BudgetRow } from "./dashboard";
import type { InsightTxn } from "./insights";

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

/** Tutto lo storico (qualche migliaio di righe al massimo): base per le pagine di analisi. */
export async function loadAll() {
  const supabase = await createClient();
  const [categories, subcategories, budgets, txns] = await Promise.all([
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
  ]);
  return {
    categories,
    subcategories,
    budgets: budgets.map((b) => ({ ...b, amount_cents: Number(b.amount_cents) })),
    txns: txns.map((t) => ({ ...t, amount_cents: Number(t.amount_cents) })),
  };
}
