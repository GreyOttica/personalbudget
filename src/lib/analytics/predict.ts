// Previsioni statistiche sul mese in corso. Funzioni pure, testate in scripts/test-analytics.ts.
//
// Metodo (adatto a pochi mesi di storico, senza modelli che imparerebbero il rumore):
// - Simulazione Monte Carlo del resto del mese: ogni giorno futuro "ripesca" un giorno vero dello storico
//   (ultimi 180 giorni), di preferenza dello stesso giorno della settimana e con più peso ai giorni recenti.
//   Si ripesca il giorno intero (tutte le categorie insieme), così restano i legami tra le spese.
// - Le spese fisse (affitto, abbonamenti, ricorrenti) non si simulano: vengono dalla dashboard.
// - Dalle simulazioni: forchetta (10°–90° percentile), valore probabile (mediana), probabilità di sforare.
// - Quota giornaliera: quanto resta per le spese variabili, ripartito sui giorni rimasti secondo quanto
//   spendi di solito in ciascun giorno della settimana.
// - Precisione: la stessa simulazione rifatta a metà dei mesi passati e confrontata con com'è andata.

import { addDays, addMonths, daysIn, monthOf, weekdayOf, type AnalyticsCategory, type Dashboard } from "./dashboard.ts";
import { goalProgress, type Goal } from "./insights.ts";
export { weightedQuantile } from "./dashboard.ts";

export type PredictTxn = { occurred_on: string; type: string; amount_cents: number; category_id: string };
export type Band = { p10: number; p50: number; p90: number };

export type Quota = {
  /** quota di spesa variabile per oggi (centesimi), già corretta per il giorno della settimana */
  today: number;
  /** speso oggi in spese variabili */
  spentToday: number;
  /** spesa variabile ancora disponibile da oggi a fine mese per centrare l'obiettivo di risparmio */
  left: number;
  /** quanto il giorno della settimana di oggi pesa rispetto a un giorno medio (1 = medio) */
  weekdayFactor: number;
  /** rispetto al ritmo previsto fino a ieri: positivo = hai speso meno (bene) */
  vsPace: number;
  /** giorni di fila (fino a ieri) sotto la quota del giorno */
  streak: number;
};

export type Prediction = {
  month: string;
  sims: number;
  /** spese variabili a fine mese (già spese + simulate) */
  variable: Band;
  /** spese totali a fine mese: fisse (dalla dashboard) + variabili */
  expense: Band;
  fixed: number;
  income: number;
  /** risparmio a fine mese = entrate attese − spese (gli investimenti contano come risparmio) */
  savings: Band;
  /** risparmio "di solito": media dei mesi completi che pesa di più i recenti */
  usualSavings: number | null;
  savingsTarget: number;
  /** "goals": le quote mensili degli obiettivi superano l'obiettivo di risparmio, e la quota giornaliera parte da quelle */
  targetSource: "custom" | "usual" | "goals" | "none";
  /** quanto chiedono questo mese gli obiettivi con una scadenza */
  goalsNeed: number;
  /** probabilità che il risparmio del mese copra le quote degli obiettivi */
  probGoals: number | null;
  /** probabilità di risparmiare almeno quanto di solito */
  probAboveUsual: number | null;
  categories: Map<string, Band & { probOver: number | null }>;
  quota: Quota | null;
  /** giorni di storico usati per la simulazione */
  historyDays: number;
};

export type Accuracy = { months: number; error: number | null; coverage: number | null };

export const SIMS = 2000;
const POOL_DAYS = 180;
const HALF_LIFE_DAYS = 60;
const SAME_WEEKDAY = 0.7; // probabilità di ripescare lo stesso giorno della settimana
const WEEKDAY_SHRINK = 5; // giorni "virtuali" di media generale nel fattore del giorno della settimana
const SAVINGS_HALF_LIFE_MONTHS = 3;

// --- numeri casuali riproducibili (stessa previsione per tutto il giorno) ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);

/** Percentile di un array già ordinato. */
function q(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}
const band = (values: number[]): Band => {
  const s = [...values].sort((a, b) => a - b);
  return { p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) };
};

/** Media esponenziale: il valore più recente è l'ultimo dell'array. */
export function ewma(values: number[], halfLife: number): number | null {
  if (!values.length) return null;
  let sw = 0;
  let s = 0;
  values.forEach((v, i) => {
    const w = 0.5 ** ((values.length - 1 - i) / halfLife);
    sw += w;
    s += w * v;
  });
  return s / sw;
}

// --- storico giornaliero ----------------------------------------------------------

type Pool = { dates: string[]; vectors: Map<string, number>[]; totals: number[]; weights: number[]; byWeekday: number[][] };

/** Giorni dello storico prima di `until` (escluso): spese variabili per categoria. */
function buildPool(txns: PredictTxn[], variableCats: Set<string>, until: string): Pool {
  const firstDate = txns.reduce((m, t) => (t.type !== "opening_balance" && t.occurred_on < m ? t.occurred_on : m), until);
  const from = addDays(until, -POOL_DAYS) > firstDate ? addDays(until, -POOL_DAYS) : firstDate;
  const byDate = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (t.type !== "expense" || !variableCats.has(t.category_id) || t.occurred_on < from || t.occurred_on >= until) continue;
    const v = byDate.get(t.occurred_on) ?? new Map<string, number>();
    v.set(t.category_id, (v.get(t.category_id) ?? 0) + t.amount_cents);
    byDate.set(t.occurred_on, v);
  }
  const pool: Pool = { dates: [], vectors: [], totals: [], weights: [], byWeekday: [[], [], [], [], [], [], []] };
  // Anche i giorni senza spese fanno parte dello storico (zero è un valore vero).
  for (let d = from; d < until; d = addDays(d, 1)) {
    const v = byDate.get(d) ?? new Map<string, number>();
    const age = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
    pool.byWeekday[weekdayOf(d)].push(pool.dates.length);
    pool.dates.push(d);
    pool.vectors.push(v);
    pool.totals.push([...v.values()].reduce((s, x) => s + x, 0));
    pool.weights.push(0.5 ** (age / HALF_LIFE_DAYS));
  }
  return pool;
}

/** Estrazione pesata da un sottoinsieme di indici del pool (somme cumulative precalcolate). */
function sampler(pool: Pool, indices: number[]) {
  const cum: number[] = [];
  let s = 0;
  for (const i of indices) cum.push((s += pool.weights[i]));
  return (r: number) => {
    const x = r * s;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return indices[lo];
  };
}

/** Fattore del giorno della settimana: spesa media di quel giorno / spesa media, con prudenza se i dati sono pochi. */
function weekdayFactors(pool: Pool): number[] {
  const wAll = pool.weights.reduce((s, w) => s + w, 0);
  const mAll = wAll ? pool.totals.reduce((s, t, i) => s + t * pool.weights[i], 0) / wAll : 0;
  if (!mAll) return [1, 1, 1, 1, 1, 1, 1];
  return pool.byWeekday.map((idx) => {
    const w = idx.reduce((s, i) => s + pool.weights[i], 0);
    const m = w ? idx.reduce((s, i) => s + pool.totals[i] * pool.weights[i], 0) / w : mAll;
    const n = idx.length;
    return ((n * m + WEEKDAY_SHRINK * mAll) / (n + WEEKDAY_SHRINK)) / mAll;
  });
}

/** Simula le spese variabili dei giorni `days`: per ogni simulazione, totale e somma per categoria. */
function simulate(pool: Pool, days: string[], sims: number, seed: number) {
  const rnd = mulberry32(seed);
  const all = pool.dates.map((_, i) => i);
  const anyDay = sampler(pool, all);
  const sameDay = pool.byWeekday.map((idx) => (idx.length ? sampler(pool, idx) : anyDay));
  const totals = new Float64Array(sims);
  const perCat = new Map<string, Float64Array>();
  if (!all.length) return { totals: [...totals], perCat };
  for (let s = 0; s < sims; s++) {
    let tot = 0;
    for (const d of days) {
      const pick = rnd() < SAME_WEEKDAY ? sameDay[weekdayOf(d)] : anyDay;
      const i = pick(rnd());
      tot += pool.totals[i];
      for (const [cat, v] of pool.vectors[i]) {
        let arr = perCat.get(cat);
        if (!arr) perCat.set(cat, (arr = new Float64Array(sims)));
        arr[s] += v;
      }
    }
    totals[s] = tot;
  }
  return { totals: [...totals], perCat };
}

// --- previsione del mese in corso -------------------------------------------------

export type PredictInput = {
  txns: PredictTxn[];
  categories: AnalyticsCategory[];
  /** dashboard del mese in corso (spese fisse, entrate attese, budget per categoria) */
  dashboard: Pick<Dashboard, "month" | "isCurrentMonth" | "day" | "daysInMonth" | "categories" | "forecast" | "totals">;
  today: string;
  /** obiettivo di risparmio mensile scelto dall'utente (centesimi), altrimenti "come di solito" */
  savingsTarget?: number | null;
  /** obiettivi attivi: le loro quote mensili entrano nell'obiettivo di risparmio */
  goals?: Goal[];
  sims?: number;
};

/** Risparmio (entrate − spese) dei mesi completi prima di `month`, dal più vecchio al più recente (fino a 12). */
export function monthlySavings(txns: PredictTxn[], month: string): number[] {
  const per = new Map<string, number>();
  for (const t of txns) {
    const m = monthOf(t.occurred_on);
    if (m >= month || (t.type !== "income" && t.type !== "expense")) continue;
    per.set(m, (per.get(m) ?? 0) + (t.type === "income" ? t.amount_cents : -t.amount_cents));
  }
  return [...per.keys()].sort().slice(-12).map((m) => per.get(m)!);
}

export function predictMonth(input: PredictInput): Prediction | null {
  const d = input.dashboard;
  if (!d.isCurrentMonth || !d.forecast) return null;
  const sims = input.sims ?? SIMS;
  const variableCats = new Set(input.categories.filter((c) => c.kind === "expense" && !c.is_fixed).map((c) => c.id));
  const pool = buildPool(input.txns, variableCats, input.today);
  const end = `${d.month}-${String(d.daysInMonth).padStart(2, "0")}`;
  const future: string[] = [];
  for (let x = addDays(input.today, 1); x <= end; x = addDays(x, 1)) future.push(x);
  const sim = simulate(pool, future, sims, seedOf(input.today));

  const variableRows = d.categories.filter((c) => !c.isFixed);
  const variableSpent = variableRows.reduce((s, c) => s + c.spent, 0);
  const fixed = d.categories.filter((c) => c.isFixed).reduce((s, c) => s + (c.forecast ?? c.spent), 0);
  const income = d.forecast.income;

  const categories = new Map<string, Band & { probOver: number | null }>();
  for (const c of variableRows) {
    const arr = sim.perCat.get(c.id);
    const values = Array.from({ length: sims }, (_, i) => c.spent + (arr ? arr[i] : 0));
    const over = c.budget ? values.filter((v) => v > c.budget!).length / sims : null;
    categories.set(c.id, { ...band(values), probOver: over });
  }

  const variableValues = sim.totals.map((t) => variableSpent + t);
  const savingsValues = variableValues.map((v) => income - fixed - v);
  const history = monthlySavings(input.txns, d.month);
  const usual = ewma(history, SAVINGS_HALF_LIFE_MONTHS);
  const usualSavings = usual === null ? null : Math.round(usual);
  const goalsNeed = goalsMonthlyNeed(input.goals ?? [], input.today);
  const base = input.savingsTarget ?? usualSavings;
  const target = goalsNeed > 0 && (base === null || goalsNeed > base) ? goalsNeed : base;

  return {
    month: d.month,
    sims,
    variable: band(variableValues),
    expense: band(variableValues.map((v) => v + fixed)),
    fixed,
    income,
    savings: band(savingsValues),
    usualSavings,
    savingsTarget: Math.max(0, target ?? 0),
    targetSource: target === goalsNeed && goalsNeed > 0 && target !== base ? "goals" : input.savingsTarget != null ? "custom" : usualSavings !== null ? "usual" : "none",
    goalsNeed,
    probGoals: goalsNeed > 0 ? savingsValues.filter((x) => x >= goalsNeed).length / sims : null,
    probAboveUsual: usualSavings === null ? null : savingsValues.filter((s) => s >= usualSavings).length / sims,
    categories,
    quota: target === null || target === undefined ? null : dailyQuota(input, pool, variableSpent, income - fixed - Math.max(0, target)),
    historyDays: pool.dates.length,
  };
}

/** `allowance`: spesa variabile del mese compatibile con l'obiettivo di risparmio. */
function dailyQuota(input: PredictInput, pool: Pool, variableSpent: number, allowance: number): Quota {
  const d = input.dashboard;
  const f = weekdayFactors(pool);
  const start = `${d.month}-01`;
  const end = `${d.month}-${String(d.daysInMonth).padStart(2, "0")}`;
  const variableCats = new Set(input.categories.filter((c) => c.kind === "expense" && !c.is_fixed).map((c) => c.id));
  const spentOn = new Map<string, number>();
  for (const t of input.txns) {
    if (t.type === "expense" && variableCats.has(t.category_id) && t.occurred_on >= start && t.occurred_on <= end)
      spentOn.set(t.occurred_on, (spentOn.get(t.occurred_on) ?? 0) + t.amount_cents);
  }
  const monthDays: string[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) monthDays.push(x);
  const fSum = monthDays.reduce((s, x) => s + f[weekdayOf(x)], 0);
  const planned = (x: string) => (allowance > 0 ? (allowance * f[weekdayOf(x)]) / fSum : 0);

  const spentToday = spentOn.get(input.today) ?? 0;
  const remaining = monthDays.filter((x) => x >= input.today);
  const fLeft = remaining.reduce((s, x) => s + f[weekdayOf(x)], 0);
  const left = allowance - variableSpent + spentToday; // da oggi (compreso) a fine mese
  const today = fLeft > 0 ? Math.max(0, Math.round((left * f[weekdayOf(input.today)]) / fLeft)) : 0;

  const past = monthDays.filter((x) => x < input.today);
  const vsPace = Math.round(past.reduce((s, x) => s + planned(x) - (spentOn.get(x) ?? 0), 0));
  let streak = 0;
  for (let i = past.length - 1; i >= 0 && allowance > 0; i--) {
    if ((spentOn.get(past[i]) ?? 0) <= planned(past[i])) streak++;
    else break;
  }
  return { today, spentToday, left: Math.round(left), weekdayFactor: Math.round(f[weekdayOf(input.today)] * 100) / 100, vsPace, streak };
}

// --- obiettivi -----------------------------------------------------------------------

/** Somma delle quote mensili degli obiettivi con scadenza, non ancora raggiunti. */
export function goalsMonthlyNeed(goals: Goal[], today: string): number {
  return goals.reduce((s, g) => {
    const p = goalProgress(g, today);
    return s + (!p.done && p.perMonth ? p.perMonth : 0);
  }, 0);
}

export type GoalForecast = { id: string; perMonth: number | null; eta: string | null; onTime: boolean | null };

/**
 * Quando arrivi a ciascun obiettivo se ogni mese metti da parte quanto risparmi di solito (il mese in corso:
 * il risparmio previsto), riempiendo
 * prima quelli che scadono prima. `eta` = mese (AAAA-MM) in cui l'obiettivo è completo.
 */
export function goalForecasts(goals: Goal[], today: string, monthlySaving: number | null, thisMonthSaving?: number | null): GoalForecast[] {
  const active = goals
    .map((g) => ({ g, p: goalProgress(g, today) }))
    .sort((a, b) => (a.g.target_date ?? "9999").localeCompare(b.g.target_date ?? "9999"));
  const left = new Map(active.map(({ g, p }) => [g.id, p.remaining]));
  const eta = new Map<string, string | null>(active.map(({ g, p }) => [g.id, p.done ? monthOf(today) : null]));
  if (monthlySaving && monthlySaving > 0) {
    let month = monthOf(today);
    for (let i = 0; i < 120 && [...left.values()].some((x) => x > 0); i++) {
      // Il mese in corso con il risparmio previsto, i successivi con quello di solito.
      let budget = i === 0 && thisMonthSaving != null ? Math.max(0, thisMonthSaving) : monthlySaving;
      for (const { g } of active) {
        const need = left.get(g.id)!;
        if (need <= 0 || budget <= 0) continue;
        const put = Math.min(need, budget);
        budget -= put;
        left.set(g.id, need - put);
        if (need - put <= 0) eta.set(g.id, month);
      }
      month = addMonths(month, 1);
    }
  }
  return active.map(({ g, p }) => {
    const e = eta.get(g.id) ?? null;
    return { id: g.id, perMonth: p.perMonth, eta: e, onTime: g.target_date && e ? e <= g.target_date.slice(0, 7) : g.target_date ? false : null };
  });
}

// --- precisione: la stessa previsione rifatta sui mesi passati ----------------------

/**
 * Per ciascuno degli ultimi `months` mesi completi: previsione delle spese variabili fatta il giorno 15
 * con i soli dati di allora, confrontata con il totale vero. Errore = |mediana − vero| / vero (media sui mesi);
 * copertura = quante volte il vero è caduto nella forchetta 10°–90°.
 */
export function backtest(txns: PredictTxn[], categories: AnalyticsCategory[], currentMonth: string, months = 6, sims = 600): Accuracy {
  const variableCats = new Set(categories.filter((c) => c.kind === "expense" && !c.is_fixed).map((c) => c.id));
  const firstDate = txns.reduce((m, t) => (t.type !== "opening_balance" && t.occurred_on < m ? t.occurred_on : m), `${currentMonth}-01`);
  const errors: number[] = [];
  let covered = 0;
  for (let i = 1; i <= months; i++) {
    const [y, mo] = currentMonth.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1 - i, 1));
    const m = dt.toISOString().slice(0, 7);
    const cutoff = `${m}-15`;
    if (addDays(cutoff, -60) < firstDate) break; // servono almeno due mesi di storico prima
    const end = `${m}-${String(daysIn(m)).padStart(2, "0")}`;
    let before = 0;
    let actual = 0;
    for (const t of txns) {
      if (t.type !== "expense" || !variableCats.has(t.category_id) || monthOf(t.occurred_on) !== m) continue;
      actual += t.amount_cents;
      if (t.occurred_on < cutoff) before += t.amount_cents;
    }
    if (actual <= 0) continue;
    const pool = buildPool(txns, variableCats, cutoff);
    const days: string[] = [];
    for (let x = cutoff; x <= end; x = addDays(x, 1)) days.push(x);
    const b = band(simulate(pool, days, sims, seedOf(m)).totals.map((v) => before + v));
    errors.push(Math.abs(b.p50 - actual) / actual);
    if (actual >= b.p10 && actual <= b.p90) covered++;
  }
  return {
    months: errors.length,
    error: errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : null,
    coverage: errors.length ? covered / errors.length : null,
  };
}

// --- dashboard con le previsioni applicate -----------------------------------------

/**
 * Sostituisce le stime delle categorie variabili con la mediana della simulazione e aggiunge
 * la probabilità di sforare: così Home, Budget, avvisi e AI usano gli stessi numeri.
 */
export function applyPrediction<D extends Dashboard>(d: D, p: Prediction | null): D {
  if (!p || !d.forecast) return d;
  const categories = d.categories.map((c) => {
    const s = p.categories.get(c.id);
    return s ? { ...c, forecast: s.p50, forecastBand: { p10: s.p10, p50: s.p50, p90: s.p90 }, probOver: s.probOver } : c;
  });
  const variable = categories.filter((c) => !c.isFixed).reduce((s, c) => s + (c.forecast ?? c.spent), 0);
  const expense = p.fixed + variable;
  const budgeted = categories.reduce((s, c) => s + (c.budget !== null ? (c.forecast ?? 0) : 0), 0);
  const ratio = d.budget.total ? budgeted / d.budget.total : null;
  const forecastStatus = ratio === null ? "none" : ratio > 1 ? "over" : ratio >= 0.8 ? "warning" : "ok";
  return {
    ...d,
    categories,
    forecast: { ...d.forecast, expense, variable, fixed: p.fixed, savingsRate: d.forecast.income > 0 ? (d.forecast.income - expense) / d.forecast.income : null },
    budget: { ...d.budget, forecastStatus },
  };
}
