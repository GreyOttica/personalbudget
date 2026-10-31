// Tutti i numeri della dashboard (e, in Fase 4, quelli passati all'AI) si
// calcolano qui, in centesimi interi. Nessuna dipendenza da React o Supabase:
// funzioni pure, testate in scripts/test-analytics.ts.

export type AnalyticsTxn = {
  occurred_on: string; // YYYY-MM-DD
  type: "expense" | "income" | "investment";
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
};

export type AnalyticsCategory = {
  id: string;
  name: string;
  emoji: string;
  kind: "expense" | "income" | "investment";
  is_fixed: boolean;
};

export type AnalyticsSubcategory = { id: string; category_id: string; name: string };

/** Un importo di budget vale dal mese valid_from (YYYY-MM-01) in poi, finché non ne arriva uno successivo. */
export type BudgetRow = { category_id: string; valid_from: string; amount_cents: number };

export type BudgetStatus = "none" | "ok" | "warning" | "over";

/** Ricorrente automatico, visto dalla dashboard. */
export type RuleInfo = {
  category_id: string;
  type: "expense" | "income" | "investment";
  amount_cents: number;
  /** l'addebito del mese in corso non è ancora stato creato (giorno non ancora arrivato) */
  pendingThisMonth: boolean;
};

export type CategoryRow = {
  id: string;
  name: string;
  emoji: string;
  isFixed: boolean;
  spent: number;
  budget: number | null;
  /** spent / budget, null senza budget */
  ratio: number | null;
  status: BudgetStatus;
  /** media mensile degli ultimi mesi completi (fino a 6) */
  average: number;
  /** stima a fine mese: solo per il mese in corso */
  forecast: number | null;
  /** budget proposto: media 6 mesi, o ultimo mese per le spese fisse */
  proposal: number;
};

export type MonthPoint = {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  investment: number;
  savingsRate: number | null;
};

export type SubcategoryRow = {
  id: string | null;
  name: string;
  categoryId: string;
  categoryName: string;
  emoji: string;
  amount: number;
  count: number;
};

export type DayPoint = {
  date: string; // YYYY-MM-DD
  variable: number; // spese variabili del giorno
  fixed: number; // spese fisse del giorno (affitto, abbonamenti)
  count: number; // movimenti di spesa del giorno
  variableCount: number; // di cui spese variabili
  cumulativeVariable: number | null; // null per i giorni futuri
};

export type Daily = {
  days: DayPoint[];
  /** tetto di spesa variabile del mese: budget delle categorie non fisse, altrimenti la media */
  variableTarget: number;
  variableTargetSource: "budget" | "average" | "none";
  /** solo mese in corso */
  today: {
    date: string;
    spent: number;
    count: number;
    averageDaily: number; // media giornaliera variabile degli ultimi mesi
    /** quanto puoi spendere al giorno (variabile) da oggi a fine mese per restare nel tetto */
    perDayLeft: number | null;
  } | null;
  /** media delle spese variabili per giorno della settimana (lun…dom), ultime 12 settimane */
  weekdays: { weekday: number; label: string; average: number }[];
};

export type Dashboard = {
  month: string;
  isCurrentMonth: boolean;
  day: number; // giorno del mese di oggi (solo mese in corso), altrimenti giorni del mese
  daysInMonth: number;
  totals: { income: number; expense: number; fixed: number; variable: number; investment: number; savingsRate: number | null };
  forecast: { expense: number; fixed: number; variable: number; investment: number; income: number; savingsRate: number | null } | null;
  budget: { total: number; spent: number; ratio: number | null; status: BudgetStatus; forecastStatus: BudgetStatus };
  averages: { expense: number; income: number; savingsRate: number | null; months: number };
  categories: CategoryRow[];
  alerts: CategoryRow[];
  trend: MonthPoint[];
  subcategories: SubcategoryRow[];
  daily: Daily;
};

export const WARNING_RATIO = 0.8;
const AVERAGE_MONTHS = 6;
const TREND_MONTHS = 12;
// Peso, in giorni, della media storica nella stima delle spese variabili:
// a inizio mese conta soprattutto la storia, verso fine mese il ritmo attuale.
const PRIOR_DAYS = 7;
const WEEKDAY_WEEKS = 12;

const WEEKDAY_LABELS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

/** "2026-10-05" + n giorni */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = lunedì … 6 = domenica */
export function weekdayOf(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

// --- date -------------------------------------------------------------------------

export const monthOf = (isoDate: string) => isoDate.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * "over" solo oltre il 100% (non al 100% esatto); "warning" dall'80%. Per le spese
 * fisse arrivare al budget è normale: niente avviso finché non lo superano.
 */
export function statusOf(ratio: number | null, isFixed = false): BudgetStatus {
  if (ratio === null) return "none";
  if (ratio > 1) return "over";
  if (ratio >= WARNING_RATIO && !isFixed) return "warning";
  return "ok";
}

const rate = (income: number, expense: number) => (income > 0 ? (income - expense) / income : null);

/** Arrotonda per eccesso a 5 € (in centesimi): i budget proposti sono cifre tonde. */
const roundUp5 = (cents: number) => Math.ceil(cents / 500) * 500;

export function budgetFor(budgets: BudgetRow[], categoryId: string, month: string): number | null {
  let best: BudgetRow | null = null;
  for (const b of budgets) {
    if (b.category_id !== categoryId || b.valid_from.slice(0, 7) > month) continue;
    if (!best || b.valid_from > best.valid_from) best = b;
  }
  // Un budget a 0 significa "nessun budget" da quel mese in poi.
  return best && best.amount_cents > 0 ? best.amount_cents : null;
}

// --- calcolo principale ---------------------------------------------------------

export function buildDashboard(input: {
  txns: AnalyticsTxn[];
  categories: AnalyticsCategory[];
  subcategories: AnalyticsSubcategory[];
  budgets: BudgetRow[];
  month: string; // YYYY-MM da mostrare
  today: string; // YYYY-MM-DD a Roma
  /** ricorrenti automatici attivi: importo mensile e se l'addebito di questo mese deve ancora arrivare */
  rules?: RuleInfo[];
}): Dashboard {
  const { txns, categories, subcategories, budgets, month, today } = input;
  const rules = input.rules ?? [];
  const rulesBy = (categoryId: string) => rules.filter((r) => r.category_id === categoryId);
  const pendingOf = (categoryId: string) =>
    rulesBy(categoryId).reduce((s, r) => s + (r.pendingThisMonth && r.type === "expense" ? r.amount_cents : 0), 0);
  const currentMonth = monthOf(today);
  const isCurrentMonth = month === currentMonth;
  const daysInMonth = daysIn(month);
  const day = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth;

  // Totali per mese e per (mese, categoria) delle spese.
  const perMonth = new Map<string, { income: number; expense: number; investment: number }>();
  const spentBy = new Map<string, number>(); // `${month}|${categoryId}`
  const investedBy = new Map<string, number>(); // month
  for (const t of txns) {
    const m = monthOf(t.occurred_on);
    const agg = perMonth.get(m) ?? { income: 0, expense: 0, investment: 0 };
    agg[t.type] += t.amount_cents;
    perMonth.set(m, agg);
    if (t.type === "expense") spentBy.set(`${m}|${t.category_id}`, (spentBy.get(`${m}|${t.category_id}`) ?? 0) + t.amount_cents);
    if (t.type === "investment") investedBy.set(m, (investedBy.get(m) ?? 0) + t.amount_cents);
  }

  // Mesi completi precedenti con dati, per medie e proposte (fino a 6).
  const firstDataMonth = [...perMonth.keys()].sort()[0] ?? month;
  const history: string[] = [];
  for (let i = 1; i <= AVERAGE_MONTHS; i++) {
    const m = addMonths(month, -i);
    if (m < firstDataMonth) break;
    history.push(m);
  }
  const prevMonth = addMonths(month, -1);
  const avgOf = (fn: (m: string) => number) => (history.length ? history.reduce((s, m) => s + fn(m), 0) / history.length : 0);

  const ruleMonthly = (categoryId: string) =>
    rulesBy(categoryId).reduce((s, r) => s + (r.type === "expense" ? r.amount_cents : 0), 0);
  const fixedCats = new Set(categories.filter((c) => c.is_fixed && c.kind === "expense").map((c) => c.id));
  const cur = perMonth.get(month) ?? { income: 0, expense: 0, investment: 0 };
  let fixed = 0;
  for (const id of fixedCats) fixed += spentBy.get(`${month}|${id}`) ?? 0;

  // Righe per categoria di spesa.
  const rows: CategoryRow[] = categories
    .filter((c) => c.kind === "expense" || spentBy.has(`${month}|${c.id}`))
    .map((c) => {
      const spent = spentBy.get(`${month}|${c.id}`) ?? 0;
      const budget = c.kind === "expense" ? budgetFor(budgets, c.id, month) : null;
      const average = Math.round(avgOf((m) => spentBy.get(`${m}|${c.id}`) ?? 0));
      const last = spentBy.get(`${prevMonth}|${c.id}`) ?? 0;
      let forecast: number | null = null;
      if (isCurrentMonth) {
        const covered = rulesBy(c.id).some((r) => r.type === "expense");
        if (c.is_fixed && covered) {
          // Spesa fissa con ricorrente automatico: già speso + addebiti che devono ancora arrivare.
          forecast = spent + pendingOf(c.id);
        } else if (c.is_fixed) {
          // Spesa fissa senza ricorrente: si assume l'importo del mese scorso (se non già superato).
          forecast = Math.max(spent, last);
        } else {
          const remaining = daysInMonth - day;
          const dailyRate = (spent + (average / daysInMonth) * PRIOR_DAYS) / (day + PRIOR_DAYS);
          forecast = Math.round(spent + dailyRate * remaining) + pendingOf(c.id);
        }
      }
      const ratio = budget ? spent / budget : null;
      return {
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        isFixed: c.is_fixed,
        spent,
        budget,
        ratio,
        status: statusOf(ratio, c.is_fixed),
        average,
        forecast,
        proposal: roundUp5(ruleMonthly(c.id) || (c.is_fixed ? last || average : average)),
      };
    })
    .filter((r) => r.spent > 0 || r.budget !== null || r.average > 0)
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.spent - a.spent);

  const budgetTotal = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const budgetedSpent = rows.reduce((s, r) => s + (r.budget !== null ? r.spent : 0), 0);

  let forecast: Dashboard["forecast"] = null;
  let forecastStatus: BudgetStatus = "none";
  if (isCurrentMonth) {
    const fFixed = rows.filter((r) => r.isFixed).reduce((s, r) => s + (r.forecast ?? 0), 0);
    const fVariable = rows.filter((r) => !r.isFixed).reduce((s, r) => s + (r.forecast ?? 0), 0);
    const investRules = rules.filter((r) => r.type === "investment");
    const fInvest = investRules.length
      ? cur.investment + investRules.reduce((s, r) => s + (r.pendingThisMonth ? r.amount_cents : 0), 0)
      : Math.max(cur.investment, investedBy.get(prevMonth) ?? 0);
    // Entrate attese: ricorrenti di entrata ancora da arrivare, altrimenti almeno quelle del mese scorso
    // (lo stipendio di solito arriva una volta sola, spesso a fine mese).
    const incomeRules = rules.filter((r) => r.type === "income");
    const fIncome = incomeRules.length
      ? cur.income + incomeRules.reduce((s, r) => s + (r.pendingThisMonth ? r.amount_cents : 0), 0)
      : Math.max(cur.income, perMonth.get(prevMonth)?.income ?? 0);
    forecast = {
      expense: fFixed + fVariable,
      fixed: fFixed,
      variable: fVariable,
      investment: fInvest,
      income: fIncome,
      savingsRate: rate(fIncome, fFixed + fVariable),
    };
    const budgetedForecast = rows.reduce((s, r) => s + (r.budget !== null ? (r.forecast ?? 0) : 0), 0);
    forecastStatus = budgetTotal ? statusOf(budgetedForecast / budgetTotal) : "none";
  }

  const trend: MonthPoint[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    if (m < firstDataMonth) continue;
    const p = perMonth.get(m) ?? { income: 0, expense: 0, investment: 0 };
    trend.push({ month: m, ...p, savingsRate: rate(p.income, p.expense) });
  }

  const catById = new Map(categories.map((c) => [c.id, c]));
  const subById = new Map(subcategories.map((s) => [s.id, s]));
  const subAgg = new Map<string, SubcategoryRow>();
  for (const t of txns) {
    if (t.type !== "expense" || monthOf(t.occurred_on) !== month) continue;
    const key = `${t.category_id}|${t.subcategory_id ?? ""}`;
    const c = catById.get(t.category_id);
    const row = subAgg.get(key) ?? {
      id: t.subcategory_id,
      name: (t.subcategory_id && subById.get(t.subcategory_id)?.name) || c?.name || "Senza categoria",
      categoryId: t.category_id,
      categoryName: c?.name ?? "",
      emoji: c?.emoji ?? "•",
      amount: 0,
      count: 0,
    };
    row.amount += t.amount_cents;
    row.count++;
    subAgg.set(key, row);
  }

  const daily = buildDaily({ txns, fixedCats, rows, month, today, day, daysInMonth, isCurrentMonth, avgOf, spentBy });

  const avgIncome = avgOf((m) => perMonth.get(m)?.income ?? 0);
  const avgExpense = avgOf((m) => perMonth.get(m)?.expense ?? 0);

  return {
    month,
    isCurrentMonth,
    day,
    daysInMonth,
    totals: {
      income: cur.income,
      expense: cur.expense,
      fixed,
      variable: cur.expense - fixed,
      investment: cur.investment,
      savingsRate: rate(cur.income, cur.expense),
    },
    forecast,
    budget: {
      total: budgetTotal,
      spent: budgetedSpent,
      ratio: budgetTotal ? budgetedSpent / budgetTotal : null,
      status: budgetTotal ? statusOf(budgetedSpent / budgetTotal) : "none",
      forecastStatus,
    },
    averages: {
      expense: Math.round(avgExpense),
      income: Math.round(avgIncome),
      savingsRate: rate(avgIncome, avgExpense),
      months: history.length,
    },
    categories: rows,
    alerts: rows.filter((r) => r.status === "warning" || r.status === "over"),
    trend,
    subcategories: [...subAgg.values()].sort((a, b) => b.amount - a.amount),
    daily,
  };
}

// --- vista giornaliera -----------------------------------------------------------

function buildDaily(a: {
  txns: AnalyticsTxn[];
  fixedCats: Set<string>;
  rows: CategoryRow[];
  month: string;
  today: string;
  day: number;
  daysInMonth: number;
  isCurrentMonth: boolean;
  avgOf: (fn: (m: string) => number) => number;
  spentBy: Map<string, number>;
}): Daily {
  const { txns, fixedCats, rows, month, today, day, daysInMonth, isCurrentMonth } = a;

  const days: DayPoint[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: `${month}-${String(d).padStart(2, "0")}`, variable: 0, fixed: 0, count: 0, variableCount: 0, cumulativeVariable: null });
  }
  for (const t of txns) {
    if (t.type !== "expense" || monthOf(t.occurred_on) !== month) continue;
    const p = days[Number(t.occurred_on.slice(8, 10)) - 1];
    if (fixedCats.has(t.category_id)) p.fixed += t.amount_cents;
    else {
      p.variable += t.amount_cents;
      p.variableCount++;
    }
    p.count++;
  }
  let running = 0;
  for (let i = 0; i < days.length; i++) {
    running += days[i].variable;
    if (i < day) days[i].cumulativeVariable = running;
  }

  // Tetto variabile: somma dei budget delle categorie non fisse; senza budget, la media mensile.
  const budgeted = rows.filter((r) => !r.isFixed && r.budget !== null);
  const averageVariable = rows.filter((r) => !r.isFixed).reduce((s, r) => s + r.average, 0);
  const variableTarget = budgeted.length ? budgeted.reduce((s, r) => s + (r.budget ?? 0), 0) : averageVariable;
  const variableTargetSource = budgeted.length ? "budget" : averageVariable > 0 ? "average" : "none";

  let todayInfo: Daily["today"] = null;
  if (isCurrentMonth) {
    const p = days[day - 1];
    const spentBefore = days.slice(0, day - 1).reduce((s, d) => s + d.variable, 0);
    const daysLeft = daysInMonth - day + 1; // oggi compreso
    todayInfo = {
      date: today,
      spent: p.variable + p.fixed,
      count: p.count,
      averageDaily: Math.round(averageVariable / daysInMonth),
      perDayLeft: variableTargetSource === "none" ? null : Math.max(0, Math.round((variableTarget - spentBefore) / daysLeft)),
    };
  }

  // Media per giorno della settimana: ultime 12 settimane fino a oggi (o a fine mese),
  // divisa per quanti lunedì, martedì… ci sono davvero nel periodo coperto dai dati.
  const end = isCurrentMonth ? today : `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const firstTxn = txns.reduce((min, t) => (t.occurred_on < min ? t.occurred_on : min), end);
  const fromWindow = addDays(end, -WEEKDAY_WEEKS * 7 + 1);
  const start = firstTxn > fromWindow ? firstTxn : fromWindow;
  const sums = Array<number>(7).fill(0);
  const occurrences = Array<number>(7).fill(0);
  for (let d = start; d <= end; d = addDays(d, 1)) occurrences[weekdayOf(d)]++;
  for (const t of txns) {
    if (t.type !== "expense" || fixedCats.has(t.category_id) || t.occurred_on < start || t.occurred_on > end) continue;
    sums[weekdayOf(t.occurred_on)] += t.amount_cents;
  }
  const weekdays = sums.map((sum, i) => ({
    weekday: i,
    label: WEEKDAY_LABELS[i],
    average: occurrences[i] ? Math.round(sum / occurrences[i]) : 0,
  }));

  return { days, variableTarget, variableTargetSource, today: todayInfo, weekdays };
}
