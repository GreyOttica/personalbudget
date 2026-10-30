import "server-only";
import { romeDate } from "@/lib/entry/amount";
import { addMonths, buildDashboard, monthOf, type AnalyticsTxn } from "./dashboard";
import type { InsightTxn } from "./insights";
import { loadAll } from "./loadAll";

/** Mese valido "YYYY-MM" dal parametro dell'URL, altrimenti il mese in corso a Roma. */
export function parseMonth(value: string | undefined): string {
  const current = monthOf(romeDate());
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= current ? value : current;
}

/** Dashboard del mese + analisi della Home, da un unico caricamento dello storico. */
export async function loadDashboard(month: string) {
  const all = await loadAll();
  const since = `${addMonths(month, -12)}-01`;
  const until = `${addMonths(month, 1)}-01`;
  const windowTxns = all.txns.filter(
    (t): t is InsightTxn & { type: AnalyticsTxn["type"] } =>
      t.type !== "opening_balance" && t.occurred_on >= since && t.occurred_on < until,
  );
  const dashboard = buildDashboard({
    txns: windowTxns,
    categories: all.categories,
    subcategories: all.subcategories,
    budgets: all.budgets,
    month,
    today: romeDate(),
  });
  return { dashboard, categories: all.categories, subcategories: all.subcategories, txns: all.txns };
}
