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

test("vista giornaliera: ritmo, oggi, quanto resta al giorno, giorni della settimana", () => {
  const txns: AnalyticsTxn[] = [
    t("2026-09-15", "expense", 310, "bar"), // media variabile 310 €/mese (1 mese di storia)
    t("2026-10-01", "expense", 900, "rent"),
    t("2026-10-02", "expense", 10, "bar"), // venerdì
    t("2026-10-05", "expense", 20, "bar"), // lunedì
    t("2026-10-05", "expense", 5, "bar"),
    t("2026-10-10", "expense", 7.5, "bar"), // oggi
  ];
  const d = buildDashboard({
    txns,
    categories: cats,
    subcategories: [],
    budgets: [{ category_id: "bar", valid_from: "2026-10-01", amount_cents: 31000 }],
    month: "2026-10",
    today: "2026-10-10",
  });
  const daily = d.daily;
  assert.equal(daily.days.length, 31);
  assert.equal(daily.days[0].fixed, 90000, "l'affitto è a parte, non sporca il ritmo");
  assert.equal(daily.days[0].variable, 0);
  assert.equal(daily.days[4].variable, 2500);
  assert.equal(daily.days[4].count, 2);
  assert.equal(daily.days[0].count, 1);
  assert.equal(daily.days[0].variableCount, 0, "l'affitto non conta tra le spese variabili del giorno");
  assert.equal(daily.days[9].cumulativeVariable, 4250);
  assert.equal(daily.days[10].cumulativeVariable, null, "i giorni futuri non hanno valore");
  assert.equal(daily.variableTarget, 31000);
  assert.equal(daily.variableTargetSource, "budget");
  assert.equal(daily.today!.spent, 750);
  assert.equal(daily.today!.count, 1);
  // (310 − 35 spesi prima di oggi) / 22 giorni rimasti, oggi compreso
  assert.equal(daily.today!.perDayLeft, Math.round((31000 - 3500) / 22));
  assert.equal(daily.today!.averageDaily, 1000, "310 € / 31 giorni");
  const mon = daily.weekdays[0];
  const fri = daily.weekdays[4];
  assert.equal(mon.label, "lun");
  assert.ok(mon.average > fri.average);
  assert.equal(d.daily.weekdays.length, 7);
});

// --- analisi aggiuntive -------------------------------------------------------
import {
  balanceHistory,
  categoryColorSlots,
  categoryTrends,
  composition,
  goalProgress,
  recurring,
  repeatCandidates,
  smallSpends,
  tagSummaries,
  yearSummary,
  type InsightTxn,
} from "../src/lib/analytics/insights.ts";

const cats2: AnalyticsCategory[] = [
  ...cats,
  { id: "sub", name: "Abbonamenti", emoji: "🔁", kind: "expense", is_fixed: true },
  { id: "food", name: "Supermercato", emoji: "🛒", kind: "expense", is_fixed: false },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}`, emoji: "•", kind: "expense" as const, is_fixed: false })),
];
const subs2 = [
  { id: "s-bar", category_id: "bar", name: "Bar" },
  { id: "s-sim", category_id: "sub", name: "SIM" },
];
const x = (d: string, type: InsightTxn["type"], euros: number, category_id: string, extra: Partial<InsightTxn> = {}): InsightTxn => ({
  occurred_on: d,
  type,
  amount_cents: Math.round(euros * 100),
  category_id,
  subcategory_id: null,
  ...extra,
});

test("colori stabili e composizione con 'Altro'", () => {
  const txns: InsightTxn[] = [x("2026-09-01", "expense", 500, "food"), x("2026-10-01", "expense", 100, "bar")];
  for (let i = 0; i < 7; i++) txns.push(x("2026-08-01", "expense", 50 - i, `c${i}`));
  const slots = categoryColorSlots(txns, "2026-10");
  assert.equal(slots.get("food"), 1, "la categoria più pesante dell'anno ha lo slot 1");
  assert.equal(slots.get("bar"), 2);
  assert.equal(slots.size, 7);
  assert.equal(slots.get("c6"), undefined, "l'ottava categoria va in Altro");
  const c = composition([...txns, x("2026-10-02", "expense", 10, "c6"), x("2026-10-03", "expense", 30, "food")], cats2, "2026-10", slots);
  assert.equal(c.total, 14000);
  assert.deepEqual(c.slices.map((s) => s.id), ["food", "bar", "other"], "ordine per slot, Altro in fondo");
  assert.equal(c.slices.at(-1)!.amount, 1000);
  assert.equal(c.other[0].id, "c6");
});

test("piccole spese: almeno 3 volte nel mese, ≤ 10 €, niente spese fisse", () => {
  const txns: InsightTxn[] = [];
  for (const m of ["2026-07", "2026-08", "2026-09"]) for (let d = 1; d <= 20; d++) txns.push(x(`${m}-${String(d).padStart(2, "0")}`, "expense", 1.5, "bar", { subcategory_id: "s-bar" }));
  for (let d = 1; d <= 10; d++) txns.push(x(`2026-10-${String(d).padStart(2, "0")}`, "expense", 1.5, "bar", { subcategory_id: "s-bar" }));
  txns.push(x("2026-10-03", "expense", 7, "sub", { subcategory_id: "s-sim" }), x("2026-10-04", "expense", 25, "bar"));
  const s = smallSpends(txns, cats2, subs2, "2026-10");
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].name, "Bar");
  assert.equal(s.items[0].count, 10);
  assert.equal(s.items[0].total, 1500);
  assert.equal(s.items[0].monthlyAverage, 3000);
  assert.equal(s.items[0].yearly, 36000);
});

test("ricorrenti: mensili e stabili, con avviso se l'importo cambia", () => {
  const txns: InsightTxn[] = [];
  for (const [m, eur] of [["2026-05", 7.99], ["2026-06", 7.99], ["2026-07", 7.99], ["2026-08", 7.99], ["2026-09", 9.99]] as const) {
    txns.push(x(`${m}-03`, "expense", eur, "sub", { subcategory_id: "s-sim" }));
  }
  for (let d = 1; d <= 28; d++) txns.push(x(`2026-09-${String(d).padStart(2, "0")}`, "expense", 1.5, "bar", { subcategory_id: "s-bar" }));
  for (let d = 1; d <= 28; d++) txns.push(x(`2026-08-${String(d).padStart(2, "0")}`, "expense", 1.5, "bar", { subcategory_id: "s-bar" }));
  for (let d = 1; d <= 28; d++) txns.push(x(`2026-07-${String(d).padStart(2, "0")}`, "expense", 1.5, "bar", { subcategory_id: "s-bar" }));
  const r = recurring(txns, cats2, subs2, "2026-10-10");
  assert.equal(r.length, 1, "il caffè quotidiano non è un abbonamento");
  assert.equal(r[0].name, "SIM");
  assert.equal(r[0].typical, 799);
  assert.equal(r[0].changed, true);
  assert.equal(r[0].last, 999);
  assert.equal(r[0].nextDate, "2026-10-03");
});

test("saldo del conto: iniziale + entrate − spese − investimenti", () => {
  const b = balanceHistory(
    [
      x("2025-12-24", "opening_balance", 3350, "altro"),
      x("2025-12-27", "expense", 50, "bar"),
      x("2026-01-10", "income", 2000, "pay"),
      x("2026-01-15", "expense", 900, "rent"),
      x("2026-01-29", "investment", 200, "inv"),
    ],
    "2026-02-05",
  );
  assert.deepEqual(b.points.map((p) => [p.month, p.balance]), [["2025-12", 330000], ["2026-01", 420000], ["2026-02", 420000]]);
  assert.equal(b.current, 420000);
  assert.equal(b.opening!.amount, 335000);
});

test("andamento per categoria, riepilogo dell'anno, tag", () => {
  const txns: InsightTxn[] = [
    x("2025-11-05", "income", 2000, "pay"),
    x("2025-11-06", "expense", 500, "food"),
    x("2026-01-10", "income", 2000, "pay"),
    x("2026-01-11", "expense", 400, "food"),
    x("2026-02-10", "income", 2000, "pay"),
    x("2026-02-11", "expense", 1800, "food", { tag: "Lisbona - 2026" }),
    x("2026-02-14", "expense", 200, "bar", { tag: "Lisbona - 2026" }),
  ];
  const tr = categoryTrends(txns, cats2, "2026-02", 12);
  const food = tr.find((t) => t.id === "food")!;
  assert.equal(food.values.length, 4, "dal primo mese con dati");
  assert.equal(food.current, 180000);
  assert.equal(food.average, Math.round((50000 + 0 + 40000) / 3));
  const y = yearSummary(txns, cats2, 2026);
  assert.equal(y.totals.income, 400000);
  assert.equal(y.totals.expense, 240000);
  assert.equal(y.best!.month, "2026-01");
  assert.equal(y.worst!.month, "2026-02");
  assert.equal(y.previous!.expense, 50000);
  assert.equal(y.monthsWithData, 2);
  const tags = tagSummaries(txns, cats2);
  assert.equal(tags[0].tag, "Lisbona - 2026");
  assert.equal(tags[0].total, 200000);
  assert.equal(tags[0].days, 4);
  assert.equal(tags[0].perDay, 50000);
});

test("obiettivi e spese da ripetere", () => {
  const g = goalProgress({ id: "g", name: "Viaggio", emoji: "✈️", target_cents: 80000, saved_cents: 20000, target_date: "2026-12-15" }, "2026-10-31");
  assert.equal(g.monthsLeft, 2);
  assert.equal(g.perMonth, 30000);
  assert.equal(g.ratio, 0.25);
  assert.equal(g.overdue, false);
  const r = repeatCandidates(
    [
      x("2026-10-01", "expense", 1.5, "bar", { subcategory_id: "s-bar", note: "Caffè" }),
      x("2026-10-02", "expense", 1.5, "bar", { subcategory_id: "s-bar", note: "Caffè " }),
      x("2026-10-03", "expense", 1.5, "bar", { subcategory_id: "s-bar", note: "Caffè" }),
      x("2026-10-03", "expense", 2.2, "bar"),
      x("2026-06-01", "expense", 1.5, "bar", { subcategory_id: "s-bar", note: "Caffè" }),
    ],
    "2026-10-31",
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 3, "oltre 90 giorni non conta");
  assert.equal(r[0].note, "Caffè");
});

// --- ricorrenti automatici e saldo corretto ------------------------------------
import { nextOccurrence, occurrenceIn, rulesForDashboard, type RecurringRule } from "../src/lib/analytics/insights.ts";

test("saldo con un saldo reale inserito a mano", () => {
  const txns: InsightTxn[] = [
    x("2025-12-24", "opening_balance", 3000, "altro"),
    x("2026-01-10", "income", 2000, "pay"),
    x("2026-01-20", "expense", 500, "bar"),
    x("2026-02-05", "expense", 100, "bar"),
    x("2026-02-10", "income", 2000, "pay"),
  ];
  // Senza correzioni: 3000 → 4500 a gennaio → 6400 a febbraio
  const plain = balanceHistory(txns, "2026-02-28");
  assert.equal(plain.current, 640000);
  assert.equal(plain.anchor.kind, "opening");
  // Il conto vero il 31/01 era 4.300 (200 € di spese non registrate).
  const fixed = balanceHistory(txns, "2026-02-28", [{ as_of: "2026-01-31", balance_cents: 430000 }]);
  assert.equal(fixed.anchor.kind, "checkpoint");
  assert.equal(fixed.current, 430000 - 10000 + 200000, "dopo il saldo reale si aggiungono solo i movimenti successivi");
  assert.deepEqual(fixed.points.map((p) => [p.month, p.balance]), [
    ["2025-12", 280000],
    ["2026-01", 430000],
    ["2026-02", 620000],
  ]);
  assert.deepEqual(fixed.lastCheck, { date: "2026-01-31", actual: 430000, estimated: 450000, difference: -20000 });
  // I movimenti del giorno stesso del saldo reale sono già compresi nel saldo.
  const sameDay = balanceHistory([...txns, x("2026-01-31", "expense", 50, "bar")], "2026-01-31", [{ as_of: "2026-01-31", balance_cents: 430000 }]);
  assert.equal(sameDay.current, 430000);
});

test("ricorrenti automatici: date, prossimo addebito, stima di fine mese", () => {
  const rule: RecurringRule = {
    id: "r1", name: "Affitto", type: "expense", amount_cents: 95000, category_id: "rent", subcategory_id: null,
    account_id: null, note: null, day_of_month: 31, starts_on: "2026-11-01", active: true,
  };
  assert.equal(occurrenceIn(rule, "2027-02"), "2027-02-28");
  assert.equal(occurrenceIn(rule, "2026-11"), "2026-11-30");
  assert.equal(nextOccurrence(rule, "2026-10-31"), "2026-11-30", "non prima della data di inizio");
  assert.equal(nextOccurrence({ ...rule, day_of_month: 15, starts_on: "2026-01-01" }, "2026-10-20"), "2026-11-15");

  const rent15 = { ...rule, day_of_month: 15, starts_on: "2026-01-15" };
  const before = rulesForDashboard([rent15], "2026-10-10");
  assert.equal(before[0].pendingThisMonth, true);
  assert.equal(rulesForDashboard([rent15], "2026-10-15")[0].pendingThisMonth, false, "il giorno stesso è già creato");
  assert.equal(rulesForDashboard([{ ...rent15, active: false }], "2026-10-10").length, 0);

  // Dashboard: l'affitto aumenta a 950 € e non è ancora arrivato → la stima usa 950, non i 900 del mese scorso.
  const d = buildDashboard({
    txns: [t("2026-09-15", "expense", 900, "rent"), t("2026-10-02", "expense", 10, "bar")],
    categories: cats,
    subcategories: [],
    budgets: [],
    month: "2026-10",
    today: "2026-10-10",
    rules: before,
  });
  const r = d.categories.find((c) => c.id === "rent")!;
  assert.equal(r.forecast, 95000);
  assert.equal(r.proposal, 95000, "la proposta di budget segue il ricorrente");
});
