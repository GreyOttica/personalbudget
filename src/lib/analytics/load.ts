import "server-only";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import {
  addMonths,
  buildDashboard,
  monthOf,
  type AnalyticsCategory,
  type AnalyticsSubcategory,
  type AnalyticsTxn,
  type BudgetRow,
} from "./dashboard";

/** Mese valido "YYYY-MM" dal parametro dell'URL, altrimenti il mese in corso a Roma. */
export function parseMonth(value: string | undefined): string {
  const current = monthOf(romeDate());
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= current ? value : current;
}

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

/** Dati per la dashboard del mese: i 12 mesi precedenti bastano per medie (6) e andamento (12). */
export async function loadDashboard(month: string) {
  const supabase = await createClient();
  const since = `${addMonths(month, -12)}-01`;
  const until = `${addMonths(month, 1)}-01`;

  const [categories, subcategories, budgets, txns] = await Promise.all([
    fetchAll<AnalyticsCategory>((a, b) => supabase.from("categories").select("id, name, emoji, kind, is_fixed").order("sort_order").range(a, b)),
    fetchAll<AnalyticsSubcategory>((a, b) => supabase.from("subcategories").select("id, category_id, name").range(a, b)),
    fetchAll<BudgetRow>((a, b) => supabase.from("budgets").select("category_id, valid_from, amount_cents").range(a, b)),
    fetchAll<AnalyticsTxn>((a, b) =>
      supabase
        .from("transactions")
        .select("occurred_on, type, amount_cents, category_id, subcategory_id")
        .is("deleted_at", null)
        .neq("type", "opening_balance")
        .gte("occurred_on", since)
        .lt("occurred_on", until)
        .order("occurred_on")
        .range(a, b),
    ),
  ]);

  const dashboard = buildDashboard({
    txns: txns.map((t) => ({ ...t, amount_cents: Number(t.amount_cents) })),
    categories,
    subcategories,
    budgets: budgets.map((b) => ({ ...b, amount_cents: Number(b.amount_cents) })),
    month,
    today: romeDate(),
  });
  return { dashboard, categories };
}
