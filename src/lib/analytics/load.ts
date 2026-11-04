import "server-only";
import { romeDate } from "@/lib/entry/amount";
import { addMonths, buildDashboard, monthOf, type AnalyticsTxn } from "./dashboard";
import { rulesForDashboard, type InsightTxn } from "./insights";
import { loadAll } from "./loadAll";
import { applyPrediction, backtest, predictMonth } from "./predict";

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
    rules: month === monthOf(romeDate()) ? rulesForDashboard(all.rules, romeDate()) : [],
  });
  // Mese in corso: stime dalla simulazione statistica e precisione misurata sui mesi passati.
  const current = month === monthOf(romeDate());
  const analyticTxns = all.txns.filter((t) => t.type !== "opening_balance");
  const prediction = current
    ? predictMonth({ txns: analyticTxns, categories: all.categories, dashboard, today: romeDate(), savingsTarget: all.savingsTarget, goals: all.goals })
    : null;
  const accuracy = current ? backtest(analyticTxns, all.categories, month) : null;
  return {
    dashboard: applyPrediction(dashboard, prediction),
    prediction,
    accuracy,
    savingsTarget: all.savingsTarget,
    goals: all.goals,
    tagBudgets: all.tagBudgets,
    categories: all.categories,
    subcategories: all.subcategories,
    txns: all.txns,
    rules: all.rules,
  };
}
