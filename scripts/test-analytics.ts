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

// --- fatti per l'AI e verifica delle cifre ---------------------------------------
import { dailyFacts, factNumbers, monthlyFacts, numbersIn, unknownNumbers, weeklyFacts, type FactsInput } from "../src/lib/ai/facts.ts";

function aiInput(): FactsInput {
  const txns: InsightTxn[] = [x("2025-12-24", "opening_balance", 3000, "altro")];
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    txns.push(x(`${m}-10`, "income", 2200, "pay"), x(`${m}-15`, "expense", 900, "rent"), x(`${m}-25`, "investment", 200, "inv"));
    for (let d = 1; d <= 20; d++) txns.push(x(`${m}-${String(d).padStart(2, "0")}`, "expense", 2, "bar", { subcategory_id: "s-bar", note: "Caffè" }));
    txns.push(x(`${m}-12`, "expense", 30, "food"));
  }
  txns.push(x("2026-10-10", "income", 2200, "pay"), x("2026-10-15", "expense", 900, "rent"));
  for (let d = 1; d <= 30; d++) txns.push(x(`2026-10-${String(d).padStart(2, "0")}`, "expense", 2, "bar", { subcategory_id: "s-bar", note: "Caffè" }));
  txns.push(x("2026-10-20", "expense", 12, "food"), x("2026-10-31", "expense", 160, "food", { note: "Spesa grande" }));
  return {
    txns,
    categories: cats2,
    subcategories: subs2,
    budgets: [{ category_id: "bar", valid_from: "2026-10-01", amount_cents: 4000 }],
    rules: [],
    checkpoints: [],
    goals: [{ id: "g", name: "Viaggio", emoji: "✈️", target_cents: 80000, saved_cents: 20000, target_date: "2026-12-20" }],
    today: "2026-10-31",
  };
}

test("fatti serali: giornata, mese, anomalie, leve con impatto calcolato", () => {
  const { facts, levers, period } = dailyFacts(aiInput());
  assert.deepEqual(period, { start: "2026-10-31", end: "2026-10-31" });
  assert.equal(facts.giorno.spese, 160, "il 31 solo la spesa grande (il caffè è fino al 30)");
  assert.equal(facts.giorno.movimenti.length, 1);
  assert.equal(facts.mese.spese, 900 + 60 + 160 + 12);
  assert.equal("_d" in facts.mese, false, "i dati interni non vanno all'AI");
  const bar = facts.mese.categorie.find((c) => c.nome === "Cibo fuori")!;
  assert.equal(bar.stato, "superato", "60 € su 40 € di budget");
  assert.ok(facts.anomalie.some((a) => a.tipo === "spesa_insolita" && a.euro === 160), "160 € al supermercato oggi contro una mediana di 30 €");
  assert.equal(facts.piccole_spese.voci[0].nome, "Bar");
  assert.equal(facts.piccole_spese.voci[0].volte, 30);
  const rientro = levers.find((l) => l.tipo === "rientro_budget")!;
  assert.equal(rientro.euro_mese, 20, "rientrare da 60 € a 40 €");
  const caffe = levers.find((l) => l.tipo === "piccola_spesa")!;
  assert.equal(caffe.euro_mese, 30, "dimezzare 60 € al mese di caffè");
  assert.equal(caffe.euro_anno, 360);
  assert.deepEqual(levers.map((l) => l.id), levers.map((_, i) => `L${i + 1}`));
  assert.ok(levers.every((l, i) => i === 0 || levers[i - 1].euro_mese >= l.euro_mese), "leve ordinate per impatto");
  assert.equal(facts.obiettivi[0].al_mese, 300);
});

test("fatti settimanali e mensili: periodi giusti", () => {
  const input = { ...aiInput(), today: "2026-11-02" }; // lunedì
  const w = weeklyFacts(input);
  assert.deepEqual(w.period, { start: "2026-10-26", end: "2026-11-01" }, "da lunedì a domenica scorsa");
  assert.equal(w.facts.settimana.per_giorno.length, 7);
  assert.equal(w.facts.settimana.per_giorno[0].giorno, "lunedì");
  const m = monthlyFacts({ ...aiInput(), today: "2026-11-01" });
  assert.deepEqual(m.period, { start: "2026-10-01", end: "2026-10-31" });
  assert.equal(m.facts.mese.in_corso, false);
  assert.equal(m.facts.saldo_conto_stimato_oggi, 3000 + 4 * 2200 - 3 * (900 + 40 + 30 + 200) - (900 + 60 + 172), "saldo iniziale + entrate − spese − investimenti");
});

test("verifica delle cifre: segnala solo i numeri che non sono nei fatti", () => {
  assert.deepEqual(numbersIn("Hai speso 1.234 € (12,5%) in 3 giorni"), [1234, 12.5, 3]);
  const known = factNumbers({ a: 1234, b: { c: [12.5, 300] }, d: "media 45 € al mese" });
  assert.deepEqual(unknownNumbers("Spese 1.234 €, 12,5%, media 45 €, il 15 ottobre 2026", known), []);
  assert.deepEqual(unknownNumbers("Risparmieresti 270 € al mese", known), [270]);
  assert.deepEqual(unknownNumbers("Circa 1.235 €", known), [], "tolleranza di arrotondamento");
});

import { projection } from "../src/lib/ai/facts.ts";

test("proiezione: posso permettermi 800 € a dicembre?", () => {
  const input = aiInput();
  const p = projection(input, "2026-12", 800);
  // Mesi completi luglio–settembre: netto = 2200 − (900 + 40 + 30) − 200 = 1030 al mese.
  assert.equal(p.risparmio_netto_medio_mensile, 1030);
  assert.equal(p.mesi_completi_da_qui, 2);
  const today = balanceHistory(input.txns, input.today).current / 100;
  assert.equal(p.saldo_conto_oggi, Math.round(today));
  assert.equal(p.saldo_previsto_fine_periodo, Math.round(today + p.movimento_previsto_resto_mese + 2 * 1030));
  assert.equal(p.saldo_dopo_la_spesa, p.saldo_previsto_fine_periodo - 800);
  assert.equal(p.obiettivi_in_scadenza.length, 1, "il viaggio di dicembre rientra nel periodo");
  assert.equal(p.attenzione, undefined);
});

// --- Fase 5: segnali sul budget, proposte, orari di Roma --------------------------------
import { budgetSignals, signalText } from "../src/lib/analytics/alerts.ts";
import { buildProposal } from "../src/lib/analytics/proposal.ts";
import { dueJobs, romeNow } from "../src/lib/notify/time.ts";

const row = (o: Partial<import("../src/lib/analytics/dashboard.ts").CategoryRow>) => ({
  id: "c", name: "Ristoranti", emoji: "🍝", isFixed: false, spent: 0, budget: null, ratio: null, status: "none" as const, average: 0, forecast: null, proposal: 0, ...o,
});

test("budgetSignals: proiezione, 80%, superato; niente per le fisse sotto il budget", () => {
  const d = {
    month: "2026-11", isCurrentMonth: true, day: 10, daysInMonth: 30,
    categories: [
      row({ id: "r", spent: 12000, budget: 25000, ratio: 0.48, status: "ok", forecast: 32000 }),
      row({ id: "s", name: "Spesa", spent: 33000, budget: 40000, ratio: 0.825, status: "warning", forecast: 90000 }),
      row({ id: "b", name: "Bar", spent: 6000, budget: 5000, ratio: 1.2, status: "over", forecast: 15000 }),
      row({ id: "a", name: "Affitto", isFixed: true, spent: 90000, budget: 90000, ratio: 1, status: "ok", forecast: 90000 }),
      row({ id: "x", name: "Casa", spent: 1000, budget: 10000, ratio: 0.1, status: "ok", forecast: 10400 }), // sfora di poco: niente
    ],
  };
  const s = budgetSignals(d);
  assert.deepEqual(s.map((x) => `${x.level}:${x.categoryId}`), ["over:b", "warning:s", "projection:r"]);
  assert.equal(s[2].key, "projection:r:2026-11");
  assert.equal(s[2].perDayLeft, Math.floor(13000 / 21));
  const t = signalText(s[2]);
  assert.match(t.title, /Ristoranti: così sforerai il budget/);
  assert.match(t.body, /320\s€ su 250\s€ \(\+70\s€\)/);
  assert.equal(budgetSignals({ ...d, day: 3 }).filter((x) => x.level === "projection").length, 0, "prima del giorno 5 niente proiezioni");
  assert.equal(budgetSignals({ ...d, isCurrentMonth: false }).length, 0);
});

test("buildProposal: totali, risparmio e avvisi calcolati dal codice", () => {
  const cats = [
    { id: "aff", name: "Affitto", emoji: "🔑", kind: "expense" as const, is_fixed: true },
    { id: "ris", name: "Ristoranti", emoji: "🍝", kind: "expense" as const, is_fixed: false },
    { id: "sup", name: "Supermercato", emoji: "🛒", kind: "expense" as const, is_fixed: false },
    { id: "sti", name: "Stipendio", emoji: "💼", kind: "income" as const, is_fixed: false },
  ];
  const d = {
    averages: { income: 230000, expense: 160000, savingsRate: (230000 - 160000) / 230000, months: 6 },
    categories: [
      row({ id: "aff", isFixed: true, budget: 90000, average: 90000 }),
      row({ id: "ris", budget: 25000, average: 24000 }),
      row({ id: "sup", budget: null, average: 30000 }),
    ],
  };
  const p = buildProposal(d, cats as never, [{ categoryId: "ris", cents: 10000 }, { categoryId: "sup", cents: 28000 }, { categoryId: "aff", cents: 80000 }]);
  assert.equal(p.summary.budget_totale_attuale, 1150);
  assert.equal(p.summary.budget_totale_proposto, 800 + 100 + 280);
  assert.equal(p.summary.spesa_prevista_con_proposta, 1180);
  assert.equal(p.summary.risparmio_mensile_previsto, 2300 - 1180);
  assert.equal(p.items.length, 3);
  assert.ok(p.summary.avvisi.some((a) => a.startsWith("Affitto è una spesa fissa")));
  assert.ok(p.summary.avvisi.some((a) => a.startsWith("Ristoranti: 100 €")));
});

test("romeNow e dueJobs: ora legale e orari dei job", () => {
  // 21:30 a Roma: in estate (UTC+2) è 19:30Z, in inverno (UTC+1) 20:30Z.
  assert.deepEqual(romeNow(new Date("2026-07-15T19:30:00Z")), { date: "2026-07-15", hour: 21, minute: 30, weekday: 3, day: 15 });
  assert.equal(romeNow(new Date("2026-12-15T20:30:00Z")).hour, 21);
  assert.equal(romeNow(new Date("2026-10-25T00:30:00Z")).hour, 2); // giorno del cambio d'ora
  const keys = (iso: string) => dueJobs(romeNow(new Date(iso))).map((j) => j.key);
  assert.deepEqual(keys("2026-11-02T07:00:00Z"), ["weekly:2026-11-02"]); // lunedì 8:00
  assert.deepEqual(keys("2026-11-02T06:45:00Z"), []); // lunedì 7:45
  assert.deepEqual(keys("2026-12-01T07:15:00Z"), ["monthly:2026-12-01"]);
  assert.deepEqual(keys("2026-11-03T20:00:00Z"), ["reminder:2026-11-03"]); // 21:00
  assert.deepEqual(keys("2026-11-03T20:30:00Z"), ["daily:2026-11-03"]); // 21:30
  assert.deepEqual(keys("2026-11-08T02:00:00Z"), ["backup:2026-11-08"]); // domenica 3:00
});

test("buildProposal: 0 € toglie il budget e nella stima conta la media", () => {
  const cats = [
    { id: "ris", name: "Ristoranti", emoji: "🍝", kind: "expense" as const, is_fixed: false },
    { id: "sup", name: "Supermercato", emoji: "🛒", kind: "expense" as const, is_fixed: false },
  ];
  const d = {
    averages: { income: 200000, expense: 100000, savingsRate: 0.5, months: 6 },
    categories: [row({ id: "ris", budget: 25000, average: 24000 }), row({ id: "sup", budget: null, average: 30000 })],
  };
  const p = buildProposal(d, cats as never, [{ categoryId: "ris", cents: 0 }, { categoryId: "sup", cents: 0 }]);
  assert.equal(p.items.length, 1, "Supermercato era già senza budget: nessuna modifica");
  assert.equal(p.items[0].to_cents, 0);
  assert.equal(p.summary.spesa_prevista_con_proposta, 240 + 300);
  assert.equal(p.summary.budget_totale_proposto, 0);
});

// --- Previsioni statistiche (predict.ts) e notifiche positive ------------------------
import { applyPrediction, backtest, ewma, predictMonth, weightedQuantile } from "../src/lib/analytics/predict.ts";
import { positiveMessage } from "../src/lib/notify/positive.ts";
import { buildDashboard as buildD, addDays as plusDays, weekdayOf as wd } from "../src/lib/analytics/dashboard.ts";

test("ewma e percentile pesato", () => {
  assert.equal(ewma([], 3), null);
  assert.equal(ewma([100, 100, 100], 3), 100);
  assert.ok(ewma([0, 0, 300], 1)! > 100, "l'ultimo mese pesa di più della media semplice");
  assert.equal(weightedQuantile([10, 20, 30], [1, 1, 1], 0.66), 20);
  assert.equal(weightedQuantile([10, 20, 30], [1, 1, 10], 0.66), 30);
});

/** Storico sintetico: stipendio 2000 € il 27, affitto 900 € fisso il 1°, spesa 10 €/giorno feriale e 40 € il sabato. */
function synthetic(until: string) {
  const cats = [
    { id: "sti", name: "Stipendio", emoji: "💼", kind: "income" as const, is_fixed: false },
    { id: "aff", name: "Affitto", emoji: "🔑", kind: "expense" as const, is_fixed: true },
    { id: "var", name: "Cibo", emoji: "🍝", kind: "expense" as const, is_fixed: false },
  ];
  const txns: { occurred_on: string; type: "expense" | "income"; amount_cents: number; category_id: string; subcategory_id: null }[] = [];
  for (let d = "2026-04-01"; d < until; d = plusDays(d, 1)) {
    if (d.endsWith("-01")) txns.push({ occurred_on: d, type: "expense", amount_cents: 90000, category_id: "aff", subcategory_id: null });
    if (d.endsWith("-27")) txns.push({ occurred_on: d, type: "income", amount_cents: 200000, category_id: "sti", subcategory_id: null });
    txns.push({ occurred_on: d, type: "expense", amount_cents: wd(d) === 5 ? 4000 : 1000, category_id: "var", subcategory_id: null });
  }
  return { cats, txns };
}

test("predictMonth: forchetta, entrate attese, probabilità di sforare e quota giornaliera", () => {
  const today = "2026-11-10"; // martedì
  const { cats, txns } = synthetic(plusDays(today, 1));
  const budgets = [{ category_id: "var", valid_from: "2026-11-01", amount_cents: 30000 }];
  const d = buildD({ txns: txns.filter((t) => t.occurred_on >= "2025-11-01"), categories: cats, subcategories: [], budgets, month: "2026-11", today });
  const p = predictMonth({ txns, categories: cats, dashboard: d, today, sims: 800 })!;
  assert.ok(p, "previsione per il mese in corso");
  // 20 giorni ancora: 17 feriali × 10 € + 3 sabati × 40 € ≈ 290 €, più i 10 giorni già spesi.
  const spentSoFar = d.categories.find((c) => c.id === "var")!.spent;
  assert.ok(Math.abs(p.variable.p50 - (spentSoFar + 29000)) <= 3000, `mediana ${p.variable.p50} vicina a ${spentSoFar + 29000}`);
  assert.ok(p.variable.p10 <= p.variable.p50 && p.variable.p50 <= p.variable.p90);
  assert.equal(p.income, 200000, "lo stipendio del 27 è atteso anche se non è ancora arrivato");
  assert.equal(p.fixed, 90000);
  assert.ok(p.categories.get("var")!.probOver! > 0.9, "con budget 300 € e stima ~400 € lo sforamento è quasi certo");
  assert.ok(p.usualSavings !== null && Math.abs(p.usualSavings - (200000 - 90000 - 43000)) < 6000, `risparmio di solito ${p.usualSavings}`);
  assert.ok(p.quota && p.quota.weekdayFactor < 1, "il martedì si spende meno della media");
  assert.equal(p.quota!.spentToday, 1000);
  // Stesso giorno → stessi numeri (semi fisso).
  assert.deepEqual(predictMonth({ txns, categories: cats, dashboard: d, today, sims: 800 })!.variable, p.variable);
  // applyPrediction: la stima della categoria diventa la mediana simulata.
  const d2 = applyPrediction(d, p);
  assert.equal(d2.categories.find((c) => c.id === "var")!.forecast, p.categories.get("var")!.p50);
  assert.equal(d2.forecast!.expense, p.fixed + p.categories.get("var")!.p50);
  // Il sabato la quota è più alta: con un obiettivo fisso, quota di sabato > quota di martedì.
  const sat = "2026-11-14";
  const { txns: t2 } = synthetic(plusDays(sat, 1));
  const ds = buildD({ txns: t2, categories: cats, subcategories: [], budgets, month: "2026-11", today: sat });
  const ps = predictMonth({ txns: t2, categories: cats, dashboard: ds, today: sat, savingsTarget: 50000, sims: 300 })!;
  const pt = predictMonth({ txns, categories: cats, dashboard: d, today, savingsTarget: 50000, sims: 300 })!;
  assert.ok(ps.quota!.weekdayFactor > 1.5 && ps.quota!.today > pt.quota!.today, "quota del sabato più alta");
  assert.equal(ps.targetSource, "custom");
});

test("backtest: su dati regolari la previsione a metà mese sbaglia poco e copre il vero", () => {
  const { cats, txns } = synthetic("2026-11-10");
  const a = backtest(txns, cats, "2026-11", 4, 400);
  assert.equal(a.months, 4);
  assert.ok(a.error! < 0.05, `errore ${a.error}`);
});

test("positiveMessage: complimenti solo se probabili, serie di giorni", () => {
  const base = { month: "2026-11", usualSavings: 40000, probAboveUsual: 0.8, savings: { p10: 42000, p50: 50000, p90: 58000 }, quota: { today: 1500, spentToday: 0, left: 30000, weekdayFactor: 1, vsPace: 4500, streak: 2 } };
  const good = positiveMessage(base as never, "2026-11-12", 12)!;
  assert.equal(good.key, "good:2026-11-09");
  assert.match(good.body, /100\s€ più del solito/);
  assert.equal(positiveMessage({ ...base, probAboveUsual: 0.6 } as never, "2026-11-12", 12), null, "non abbastanza sicuro");
  assert.equal(positiveMessage(base as never, "2026-11-05", 5), null, "troppo presto nel mese");
  const streak = positiveMessage({ ...base, quota: { ...base.quota, streak: 5 } } as never, "2026-11-12", 12)!;
  assert.equal(streak.key, "streak:2026-11:5");
});

test("positiveMessage: niente complimenti se non registri da più di 2 giorni", () => {
  const base = { month: "2026-11", usualSavings: 40000, probAboveUsual: 0.9, savings: { p10: 45000, p50: 50000, p90: 58000 }, quota: { today: 1500, spentToday: 0, left: 30000, weekdayFactor: 1, vsPace: 4500, streak: 5 } };
  assert.equal(positiveMessage(base as never, "2026-11-12", 12, "2026-11-09"), null);
  assert.equal(positiveMessage(base as never, "2026-11-12", 12, null), null);
  assert.ok(positiveMessage(base as never, "2026-11-12", 12, "2026-11-11"));
});

// --- Suggerimenti per l'inserimento ----------------------------------------------------
import { favorites, habits, search, typicalAmounts } from "../src/lib/entry/suggest.ts";

test("suggerimenti: abitudini, preferiti, ricerca, importi tipici", () => {
  const T = (d: string, cat: string, sub: string | null, cents: number, note: string | null) => ({ occurred_on: d, type: "expense", amount_cents: cents, category_id: cat, subcategory_id: sub, note });
  const txns = [
    T("2026-11-01", "bar", "caffe", 150, "Caffè"),
    T("2026-11-02", "bar", "caffe", 150, "caffe"),
    T("2026-11-03", "bar", "caffe", 180, "Caffè"),
    T("2026-11-04", "bar", "caffe", 150, "Caffè"),
    T("2026-10-20", "sup", null, 3250, "Esselunga"),
    T("2026-10-27", "sup", null, 4100, "Esselunga"),
    T("2026-11-03", "sup", null, 2900, "Esselunga Viale"),
    T("2026-11-01", "aff", null, 90000, null),
    T("2026-11-01", "aff", null, 90000, null),
    T("2026-10-01", "aff", null, 90000, null),
    T("2026-04-01", "bar", "caffe", 150, "Caffè"), // fuori finestra (180 giorni)
  ];
  const h = habits(txns, "2026-11-04");
  const caffe = h.find((x) => x.subcategory_id === "caffe")!;
  assert.equal(caffe.count, 4, "Caffè e caffe sono la stessa abitudine; aprile è fuori finestra");
  assert.equal(caffe.amount_cents, 150, "importo più frequente");
  assert.equal(caffe.note, "Caffè");
  const fav = favorites(txns, "2026-11-04", new Set(["aff"]));
  assert.deepEqual(fav.map((f) => f.category_id), ["bar"], "niente affitto, niente gruppi con meno di 3 volte");
  const cats = [{ id: "bar", name: "Cibo fuori / Bevute" }, { id: "sup", name: "Supermercato" }, { id: "aff", name: "Affitto" }];
  const subs = [{ id: "caffe", name: "Caffè" }];
  assert.deepEqual(search("esse", txns, "2026-11-04", cats, subs).map((s) => s.note), ["Esselunga", "Esselunga Viale"]);
  assert.equal(search("caf", txns, "2026-11-04", cats, subs)[0].subcategory_id, "caffe");
  assert.equal(search("bevu", txns, "2026-11-04", cats, subs)[0].category_id, "bar", "anche dal nome della categoria");
  assert.deepEqual(search("x", txns, "2026-11-04", cats, subs), [], "almeno 2 lettere");
  assert.deepEqual(typicalAmounts(txns, "2026-11-04", "bar", "caffe"), [150, 180]);
});

// --- Obiettivi collegati alle previsioni ------------------------------------------------
import { goalForecasts, goalsMonthlyNeed } from "../src/lib/analytics/predict.ts";

test("obiettivi: quote mensili, arrivo previsto in ordine di scadenza, quota giornaliera", () => {
  const goals = [
    { id: "pc", name: "PC", emoji: "💻", target_cents: 120000, saved_cents: 0, target_date: "2027-06-30" },
    { id: "vi", name: "Viaggio", emoji: "✈️", target_cents: 80000, saved_cents: 20000, target_date: "2026-12-31" },
    { id: "ok", name: "Fatto", emoji: "🎉", target_cents: 1000, saved_cents: 1000, target_date: "2026-12-01" },
  ];
  // Viaggio: 600 € in 1 mese (da novembre a dicembre) = 600 €/mese; PC: 1.200 € in 7 mesi = 171,43 €/mese.
  assert.equal(goalsMonthlyNeed(goals, "2026-11-10"), 60000 + Math.ceil(120000 / 7));
  const f = new Map(goalForecasts(goals, "2026-11-10", 40000).map((x) => [x.id, x]));
  assert.equal(f.get("vi")!.eta, "2026-12", "prima il viaggio (scade prima): 400 a novembre + 200 a dicembre");
  assert.equal(f.get("vi")!.onTime, true);
  assert.equal(f.get("pc")!.eta, "2027-03", "poi il PC: 200 a dicembre, poi 400 al mese");
  assert.equal(f.get("ok")!.eta, "2026-11");
  assert.equal(goalForecasts(goals, "2026-11-10", 0).find((x) => x.id === "vi")!.eta, null, "senza risparmio niente data");
  // Nella previsione: le quote degli obiettivi alzano l'obiettivo di risparmio e la probabilità di coprirle.
  const today = "2026-11-10";
  const { cats, txns } = synthetic(plusDays(today, 1));
  const d = buildD({ txns, categories: cats, subcategories: [], budgets: [], month: "2026-11", today });
  const p = predictMonth({ txns, categories: cats, dashboard: d, today, goals: [goals[1]], sims: 300 })!;
  assert.equal(p.goalsNeed, 60000);
  assert.ok(p.probGoals !== null && p.probGoals > 0.9, "con circa 670 € di risparmio, 600 € sono quasi certi");
  const low = predictMonth({ txns, categories: cats, dashboard: d, today, goals: [{ ...goals[1], target_cents: 200000 }], savingsTarget: 10000, sims: 300 })!;
  assert.equal(low.targetSource, "goals", "le quote (1.800 €) superano l'obiettivo di 100 €");
  assert.ok(low.probGoals! < 0.05);
});

// --- Budget per viaggi ed eventi -------------------------------------------------------
import { tagBudgetStatus } from "../src/lib/analytics/tags.ts";

test("budget per tag: speso, residuo al giorno, viaggio in corso", () => {
  const txns = [
    { occurred_on: "2026-11-01", type: "expense", amount_cents: 60000, tag: "Giappone 2026" },
    { occurred_on: "2026-11-03", type: "expense", amount_cents: 52000, tag: "Giappone 2026" },
    { occurred_on: "2026-11-03", type: "expense", amount_cents: 9999, tag: "Altro" },
    { occurred_on: "2026-11-02", type: "income", amount_cents: 5000, tag: "Giappone 2026" },
  ];
  const s = tagBudgetStatus({ tag: "Giappone 2026", amount_cents: 150000, ends_on: "2026-11-07" }, txns, "2026-11-04");
  assert.equal(s.spent, 112000);
  assert.equal(s.left, 38000);
  assert.equal(s.daysLeft, 4, "dal 4 al 7 compresi");
  assert.equal(s.perDayLeft, 9500);
  assert.equal(s.level, "ok");
  assert.equal(s.active, true);
  const over = tagBudgetStatus({ tag: "Giappone 2026", amount_cents: 100000, ends_on: null }, txns, "2026-11-20");
  assert.equal(over.level, "over");
  assert.equal(over.active, false, "senza data di fine: in corso solo con spese negli ultimi 7 giorni");
  assert.equal(over.perDayLeft, null);
  assert.equal(tagBudgetStatus({ tag: "Natale", amount_cents: 30000, ends_on: "2026-12-26" }, txns, "2026-11-04").active, true, "evento entro 60 giorni");
});

test("parseAmount: punto delle migliaia all'italiana", async () => {
  const { parseAmount } = await import("../src/lib/entry/amount.ts");
  assert.equal(parseAmount("1.500"), 150000);
  assert.equal(parseAmount("12.345"), 1234500);
  assert.equal(parseAmount("2.80"), 280, "un punto con 2 decimali resta il decimale");
  assert.equal(parseAmount("1.234,56"), 123456);
  assert.equal(parseAmount("1.234.567"), 123456700);
  assert.equal(parseAmount("2,80"), 280);
});

// --- Abbonamenti ---------------------------------------------------------------------------
import { subscriptionEvents } from "../src/lib/notify/subscriptions.ts";

test("abbonamenti: aumento recente e nuovo, niente avvisi al primo controllo", () => {
  const r = (o: object) => ({ categoryId: "abb", subcategoryId: "spo", name: "Spotify", emoji: "🔁", typical: 1099, last: 1199, previous: 1099, changed: true, months: 5, yearly: 13188, lastDate: "2026-11-02", nextDate: "2026-12-02", ...o });
  const first = subscriptionEvents([r({})], "2026-11-04", null);
  assert.deepEqual(first.events.map((e) => e.kind), ["sub_up"], "al primo controllo solo gli aumenti, non i 'nuovi'");
  assert.match(first.events[0].body, /Da 10,99\s€ a 11,99\s€: 12\s€ in più l'anno/);
  assert.equal(first.events[0].key, "sub_up:abb|spo:1199");
  const later = subscriptionEvents([r({ changed: false }), r({ subcategoryId: "net", name: "Netflix", changed: false })], "2026-11-04", new Set(["sub_seen:abb|spo", "sub_seed"]));
  assert.deepEqual(later.events.map((e) => e.key), ["sub_new:abb|net"]);
  assert.equal(subscriptionEvents([r({ lastDate: "2026-09-01" })], "2026-11-04", new Set(["sub_seen:abb|spo"])).events.length, 0, "aumento vecchio: niente avviso");
});

test("abbonamenti: un aumento grande non è un aumento di abbonamento", () => {
  const r = { categoryId: "cura", subcategoryId: "cap", name: "Taglio capelli", emoji: "💇", typical: 2000, last: 3400, previous: 2000, changed: true, months: 4, yearly: 24000, lastDate: "2026-11-02", nextDate: "2026-12-02" };
  assert.equal(subscriptionEvents([r], "2026-11-04", new Set(["sub_seen:cura|cap", "sub_seed"])).events.length, 0);
});
