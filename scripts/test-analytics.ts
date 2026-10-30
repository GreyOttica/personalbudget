// Test dei calcoli della dashboard: node --test scripts/test-analytics.ts
// (con il file Excel in data/ fa anche il controllo incrociato sullo storico reale).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  addMonths,
  buildDashboard,
  budgetFor,
  daysIn,
  statusOf,
  type AnalyticsCategory,
  type AnalyticsTxn,
} from "../src/lib/analytics/dashboard.ts";
import { buildReport } from "../src/lib/import/sheet.ts";

const cats: AnalyticsCategory[] = [
  { id: "bar", name: "Cibo fuori", emoji: "🍸", kind: "expense", is_fixed: false },
  { id: "rent", name: "Affitto", emoji: "🔑", kind: "expense", is_fixed: true },
  { id: "pay", name: "Stipendio", emoji: "💼", kind: "income", is_fixed: false },
  { id: "inv", name: "Investimenti", emoji: "📈", kind: "investment", is_fixed: true },
];
const t = (d: string, type: AnalyticsTxn["type"], euros: number, category_id: string, subcategory_id: string | null = null): AnalyticsTxn => ({
  occurred_on: d,
  type,
  amount_cents: Math.round(euros * 100),
  category_id,
  subcategory_id,
});

test("date", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(daysIn("2026-02"), 28);
  assert.equal(daysIn("2028-02"), 29);
  assert.equal(statusOf(0.79), "ok");
  assert.equal(statusOf(0.8), "warning");
  assert.equal(statusOf(1), "warning", "al 100% esatto non è ancora superato");
  assert.equal(statusOf(1.01), "over");
  assert.equal(statusOf(1, true), "ok", "spesa fissa pagata per intero");
  assert.equal(statusOf(0.9, true), "ok");
  assert.equal(statusOf(1.1, true), "over");
});

test("budget valido dal mese indicato in poi", () => {
  const b = [
    { category_id: "bar", valid_from: "2026-01-01", amount_cents: 10000 },
    { category_id: "bar", valid_from: "2026-06-01", amount_cents: 15000 },
  ];
  assert.equal(budgetFor(b, "bar", "2025-12"), null);
  assert.equal(budgetFor(b, "bar", "2026-05"), 10000);
  assert.equal(budgetFor(b, "bar", "2026-10"), 15000);
});

test("mese in corso: fisse non proiettate, variabili con media storica, avvisi", () => {
  const txns: AnalyticsTxn[] = [];
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    txns.push(t(`${m}-10`, "income", 2000, "pay"), t(`${m}-15`, "expense", 900, "rent"), t(`${m}-20`, "expense", 300, "bar"));
    txns.push(t(`${m}-25`, "investment", 200, "inv"));
  }
  // Ottobre, giorno 10: affitto non ancora pagato, 120 € al bar.
  txns.push(t("2026-10-05", "income", 2000, "pay"), t("2026-10-08", "expense", 120, "bar", "s1"));
  const d = buildDashboard({
    txns,
    categories: cats,
    subcategories: [{ id: "s1", category_id: "bar", name: "Bar" }],
    budgets: [{ category_id: "bar", valid_from: "2026-10-01", amount_cents: 14000 }],
    month: "2026-10",
    today: "2026-10-10",
  });
  assert.equal(d.isCurrentMonth, true);
  assert.equal(d.totals.expense, 12000);
  assert.equal(d.totals.income, 200000);
  const rent = d.categories.find((c) => c.id === "rent")!;
  assert.equal(rent.forecast, 90000, "l'affitto non pagato si stima con l'importo del mese scorso");
  assert.equal(rent.proposal, 90000);
  const bar = d.categories.find((c) => c.id === "bar")!;
  assert.equal(bar.average, 30000);
  assert.equal(bar.proposal, 30000);
  // (120 + 300/31*7) / (10+7) * 21 + 120
  const expected = Math.round(12000 + ((12000 + (30000 / 31) * 7) / 17) * 21);
  assert.equal(bar.forecast, expected);
  assert.equal(bar.status, "warning", "120/140 = 86%");
  assert.deepEqual(d.alerts.map((a) => a.id), ["bar"]);
  assert.equal(d.forecast!.expense, 90000 + expected);
  assert.equal(d.forecast!.investment, 20000, "versamento mensile stimato dal mese scorso");
  assert.equal(d.averages.months, 3);
  assert.equal(d.subcategories[0].name, "Bar");
  assert.equal(d.trend.length, 4, "il grafico parte dal primo mese con dati");
});

test("mese passato: nessuna stima", () => {
  const d = buildDashboard({
    txns: [t("2026-09-03", "expense", 50, "bar")],
    categories: cats,
    subcategories: [],
    budgets: [],
    month: "2026-09",
    today: "2026-10-30",
  });
  assert.equal(d.forecast, null);
  assert.equal(d.categories.find((c) => c.id === "bar")!.forecast, null);
  assert.equal(d.totals.savingsRate, null, "senza entrate il risparmio non è definito");
});

const XLSX = "data/Personal_Budget_v_2.xlsx";
test("storico reale: i totali coincidono con quelli dell'import", { skip: !existsSync(XLSX) }, () => {
  const report = buildReport(readFileSync(XLSX));
  // Costruisco le transazioni con le stesse regole dell'import, tramite i totali per mese del report.
  for (const m of report.months) {
    const txns: AnalyticsTxn[] = [
      t(`${m.month}-01`, "income", m.income / 100, "pay"),
      t(`${m.month}-01`, "expense", (m.expense - m.fixed) / 100, "bar"),
      t(`${m.month}-01`, "expense", m.fixed / 100, "rent"),
      t(`${m.month}-01`, "investment", m.investment / 100, "inv"),
    ].filter((x) => x.amount_cents > 0);
    const d = buildDashboard({ txns, categories: cats, subcategories: [], budgets: [], month: m.month, today: "2026-12-31" });
    assert.equal(d.totals.expense, m.expense, m.month);
    assert.equal(d.totals.fixed, m.fixed, m.month);
    assert.equal(d.totals.investment, m.investment, m.month);
  }
});
