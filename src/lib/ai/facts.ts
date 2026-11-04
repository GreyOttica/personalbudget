// I "fatti" passati all'AI: dati già aggregati e calcolati qui, in euro interi.
// L'AI interpreta e consiglia ma non fa conti: ogni cifra che può citare è in
// questi oggetti, e l'impatto dei consigli viene dalle "leve" calcolate qui.
// Funzioni pure, testate in scripts/test-analytics.ts.
import { budgetSignals } from "../analytics/alerts.ts";
import { applyPrediction, ewma, goalForecasts, monthlySavings, predictMonth, type Prediction } from "../analytics/predict.ts";
import {
  addDays,
  addMonths,
  buildDashboard,
  monthOf,
  weekdayOf,
  type AnalyticsCategory,
  type AnalyticsSubcategory,
  type AnalyticsTxn,
  type BudgetRow,
  type Dashboard,
} from "../analytics/dashboard.ts";
import {
  balanceHistory,
  goalProgress,
  recurring,
  rulesForDashboard,
  smallSpends,
  type Checkpoint,
  type Goal,
  type InsightTxn,
  type RecurringRule,
} from "../analytics/insights.ts";

export type AnalysisKind = "daily" | "weekly" | "monthly";

export type FactsInput = {
  txns: InsightTxn[];
  categories: AnalyticsCategory[];
  subcategories: AnalyticsSubcategory[];
  budgets: BudgetRow[];
  rules: RecurringRule[];
  checkpoints: Checkpoint[];
  goals: Goal[];
  today: string;
  /** obiettivo di risparmio mensile (centesimi); null o assente = "come di solito" */
  savingsTarget?: number | null;
};

export type Lever = { id: string; tipo: string; descrizione: string; euro_mese: number; euro_anno: number; base: string };

const eur = (cents: number) => Math.round(cents / 100);
const pct = (r: number | null | undefined) => (r === null || r === undefined ? null : Math.round(r * 1000) / 10);
const WEEKDAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];
const monthName = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (m: string) => monthName.format(new Date(`${m}-01T00:00:00Z`));

const analytic = (txns: InsightTxn[]) =>
  txns.filter((t): t is InsightTxn & { type: AnalyticsTxn["type"] } => t.type !== "opening_balance");

/** Dashboard del mese; per il mese in corso con le stime della simulazione statistica (predict.ts). */
export function dashboardFor(input: FactsInput, month: string): Dashboard {
  return predictionFor(input, month).dashboard;
}

const predictionCache = new WeakMap<FactsInput, Map<string, { dashboard: Dashboard; prediction: Prediction | null }>>();

/** Dashboard e previsione del mese (la previsione solo per il mese in corso). Calcolate una volta per input. */
export function predictionFor(input: FactsInput, month: string): { dashboard: Dashboard; prediction: Prediction | null } {
  let byMonth = predictionCache.get(input);
  if (!byMonth) predictionCache.set(input, (byMonth = new Map()));
  const hit = byMonth.get(month);
  if (hit) return hit;
  const base = baseDashboard(input, month);
  const prediction =
    month === monthOf(input.today)
      ? predictMonth({ txns: analytic(input.txns), categories: input.categories, dashboard: base, today: input.today, savingsTarget: input.savingsTarget, goals: input.goals })
      : null;
  const out = { dashboard: applyPrediction(base, prediction), prediction };
  byMonth.set(month, out);
  return out;
}

function baseDashboard(input: FactsInput, month: string): Dashboard {
  const since = `${addMonths(month, -12)}-01`;
  const until = `${addMonths(month, 1)}-01`;
  return buildDashboard({
    txns: analytic(input.txns).filter((t) => t.occurred_on >= since && t.occurred_on < until),
    categories: input.categories,
    subcategories: input.subcategories,
    budgets: input.budgets,
    month,
    today: input.today,
    rules: month === monthOf(input.today) ? rulesForDashboard(input.rules, input.today) : [],
  });
}

/** Riepilogo compatto di un mese (in corso o chiuso). */
export function monthFacts(input: FactsInput, month: string) {
  const { dashboard: d, prediction: p } = predictionFor(input, month);
  const categorie = d.categories
    .filter((c) => c.spent > 0 || c.budget !== null)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 12)
    .map((c) => ({
      nome: c.name,
      fissa: c.isFixed || undefined,
      speso: eur(c.spent),
      budget: c.budget === null ? undefined : eur(c.budget),
      pct_budget: c.ratio === null ? undefined : pct(c.ratio),
      stima_fine_mese: c.forecast === null ? undefined : eur(c.forecast),
      media_mensile: eur(c.average),
      stato: c.status === "none" ? undefined : c.status === "ok" ? "ok" : c.status === "warning" ? "oltre_80" : "superato",
      stima_tra: c.forecastBand ? `${eur(c.forecastBand.p10)}-${eur(c.forecastBand.p90)}` : undefined,
      prob_sforare_budget_pct: c.probOver == null ? undefined : Math.round(c.probOver * 100),
    }));
  return {
    mese: monthLabel(month),
    in_corso: d.isCurrentMonth,
    giorno: d.isCurrentMonth ? d.day : undefined,
    giorni_del_mese: d.daysInMonth,
    entrate: eur(d.totals.income),
    spese: eur(d.totals.expense),
    spese_fisse: eur(d.totals.fixed),
    spese_variabili: eur(d.totals.variable),
    investito: eur(d.totals.investment),
    risparmio_pct: pct(d.totals.savingsRate),
    stima_spese_fine_mese: d.forecast ? eur(d.forecast.expense) : undefined,
    stima_risparmio_pct: d.forecast ? pct(d.forecast.savingsRate) : undefined,
    budget_totale: d.budget.total ? eur(d.budget.total) : undefined,
    budget_usato_pct: d.budget.ratio === null ? undefined : pct(d.budget.ratio),
    media_spese_mensili: eur(d.averages.expense),
    media_entrate_mensili: eur(d.averages.income),
    media_risparmio_pct: pct(d.averages.savingsRate),
    mesi_di_storia: d.averages.months,
    categorie,
    // Previsione statistica (simulazione sui giorni dello storico): forchette 10°–90° percentile.
    previsione: p
      ? {
          spese_fine_mese_probabili: eur(p.expense.p50),
          spese_fine_mese_tra: [eur(p.expense.p10), eur(p.expense.p90)],
          risparmio_fine_mese_probabile: eur(p.savings.p50),
          risparmio_fine_mese_tra: [eur(p.savings.p10), eur(p.savings.p90)],
          risparmio_di_solito: p.usualSavings === null ? undefined : eur(p.usualSavings),
          prob_risparmiare_piu_del_solito_pct: p.probAboveUsual === null ? undefined : Math.round(p.probAboveUsual * 100),
          obiettivo_risparmio: eur(p.savingsTarget),
          obiettivo_scelto_da: p.targetSource === "custom" ? "utente" : p.targetSource === "goals" ? "quote degli obiettivi" : "media recente",
          quote_obiettivi_mese: p.goalsNeed ? eur(p.goalsNeed) : undefined,
          prob_coprire_quote_obiettivi_pct: p.probGoals === null ? undefined : Math.round(p.probGoals * 100),
          quota_spesa_variabile_oggi: p.quota ? eur(p.quota.today) : undefined,
          rispetto_al_ritmo_previsto: p.quota ? eur(p.quota.vsPace) : undefined, // positivo = speso meno del previsto
          giorni_di_fila_sotto_quota: p.quota?.streak,
          giorni_di_storico_usati: p.historyDays,
        }
      : undefined,
    // Categorie che al ritmo attuale sforeranno (o hanno già superato) il budget.
    avvisi_budget: budgetSignals(d).map((x) => ({
      categoria: x.name,
      livello: x.level === "projection" ? "sforerà_al_ritmo_attuale" : x.level === "warning" ? "oltre_80" : "superato",
      speso: eur(x.spent),
      budget: eur(x.budget),
      stima_fine_mese: x.forecast === null ? undefined : eur(x.forecast),
      sforamento_previsto: x.forecast === null ? undefined : Math.max(0, eur(x.forecast - x.budget)),
      prob_sforare_pct: x.probOver == null ? undefined : Math.round(x.probOver * 100),
      al_giorno_per_restare_nel_budget: x.perDayLeft === null ? undefined : eur(x.perDayLeft),
    })),
    _d: d, // per uso interno (anomalie, leve): rimosso prima di inviare
  };
}

// --- anomalie e leve -------------------------------------------------------------

function bigTransactions(input: FactsInput, from: string, to: string) {
  const fixed = new Set(input.categories.filter((c) => c.is_fixed).map((c) => c.id));
  const cat = new Map(input.categories.map((c) => [c.id, c]));
  const sub = new Map(input.subcategories.map((s) => [s.id, s]));
  const since = addDays(from, -90);
  const amountsBy = new Map<string, number[]>();
  for (const t of input.txns) {
    if (t.type !== "expense" || t.occurred_on < since || t.occurred_on >= from) continue;
    amountsBy.set(t.category_id, [...(amountsBy.get(t.category_id) ?? []), t.amount_cents]);
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  return input.txns
    .filter((t) => t.type === "expense" && t.occurred_on >= from && t.occurred_on <= to && !fixed.has(t.category_id))
    .map((t) => ({ t, m: median(amountsBy.get(t.category_id) ?? []) }))
    .filter(({ t, m }) => t.amount_cents >= 3000 && m > 0 && t.amount_cents >= 3 * m)
    .sort((a, b) => b.t.amount_cents - a.t.amount_cents)
    .slice(0, 3)
    .map(({ t, m }) => ({
      tipo: "spesa_insolita",
      data: t.occurred_on,
      categoria: cat.get(t.category_id)?.name,
      sottocategoria: t.subcategory_id ? sub.get(t.subcategory_id)?.name : undefined,
      nota: t.note ?? undefined,
      euro: eur(t.amount_cents),
      mediana_categoria_90g: eur(m),
    }));
}

function anomalies(input: FactsInput, d: Dashboard, from: string, to: string) {
  const out: Record<string, unknown>[] = [...bigTransactions(input, from, to)];
  for (const c of d.categories) {
    if (c.isFixed || c.average <= 0) continue;
    const value = d.isCurrentMonth ? (c.forecast ?? c.spent) : c.spent;
    const delta = value - c.average;
    if (delta >= 3000 && value >= c.average * 1.3) {
      out.push({ tipo: "categoria_sopra_media", categoria: c.name, [d.isCurrentMonth ? "stima" : "speso"]: eur(value), media: eur(c.average), differenza: eur(delta) });
    }
  }
  for (const r of recurring(input.txns, input.categories, input.subcategories, input.today)) {
    if (r.changed && r.previous !== null) out.push({ tipo: "ricorrente_cambiato", nome: r.name, prima: eur(r.previous), ora: eur(r.last) });
  }
  return out.slice(0, 8);
}

/** Possibili risparmi con l'impatto già calcolato. L'AI può solo sceglierli e spiegarli. */
export function levers(input: FactsInput, d: Dashboard, month: string): Lever[] {
  const out: Lever[] = [];
  const small = smallSpends(input.txns, input.categories, input.subcategories, month);
  for (const s of small.items.slice(0, 4)) {
    const monthly = Math.max(s.monthlyAverage, s.total);
    out.push({
      id: "",
      tipo: "piccola_spesa",
      descrizione: `Dimezzare "${s.name}" (${s.count} volte nel mese)`,
      euro_mese: eur(monthly / 2),
      euro_anno: eur((monthly / 2) * 12),
      base: `media ${eur(monthly)} € al mese`,
    });
  }
  for (const c of d.categories) {
    if (c.isFixed) continue;
    const value = d.isCurrentMonth ? (c.forecast ?? c.spent) : c.spent;
    if (c.budget !== null && value > c.budget) {
      out.push({
        id: "",
        tipo: "rientro_budget",
        descrizione: `Rientrare nel budget di ${c.name}`,
        euro_mese: eur(value - c.budget),
        euro_anno: eur((value - c.budget) * 12),
        base: `${d.isCurrentMonth ? "stima" : "speso"} ${eur(value)} € contro budget ${eur(c.budget)} €`,
      });
    } else if (c.average > 0 && value - c.average >= 3000) {
      out.push({
        id: "",
        tipo: "ritorno_media",
        descrizione: `Riportare ${c.name} alla tua media`,
        euro_mese: eur(value - c.average),
        euro_anno: eur((value - c.average) * 12),
        base: `${d.isCurrentMonth ? "stima" : "speso"} ${eur(value)} € contro media ${eur(c.average)} €`,
      });
    }
  }
  const subsCat = new Set(input.categories.filter((c) => c.name === "Abbonamenti").map((c) => c.id));
  for (const r of input.rules.filter((r) => r.active && r.type === "expense" && subsCat.has(r.category_id))) {
    out.push({
      id: "",
      tipo: "abbonamento",
      descrizione: `Rivedere o disdire "${r.name}"`,
      euro_mese: eur(r.amount_cents),
      euro_anno: eur(r.amount_cents * 12),
      base: "ricorrente automatico",
    });
  }
  return out
    .filter((l) => l.euro_mese >= 3)
    .sort((a, b) => b.euro_mese - a.euro_mese)
    .slice(0, 8)
    .map((l, i) => ({ ...l, id: `L${i + 1}` }));
}

function smallFacts(input: FactsInput, month: string) {
  const s = smallSpends(input.txns, input.categories, input.subcategories, month);
  return {
    totale_mese: eur(s.total),
    volte: s.count,
    voci: s.items.slice(0, 5).map((i) => ({ nome: i.name, volte: i.count, mese: eur(i.total), media_mese: eur(i.monthlyAverage), anno_stimato: eur(i.yearly) })),
  };
}

function goalsFacts(input: FactsInput) {
  // Arrivo previsto mettendo da parte ogni mese il risparmio di solito, prima gli obiettivi che scadono prima.
  const usual = ewma(monthlySavings(analytic(input.txns), monthOf(input.today)), 3);
  const eta = new Map(goalForecasts(input.goals, input.today, usual).map((f) => [f.id, f]));
  return input.goals.map((g) => {
    const p = goalProgress(g, input.today);
    const f = eta.get(g.id);
    return {
      nome: g.name,
      obiettivo: eur(g.target_cents),
      messi_da_parte: eur(g.saved_cents),
      mancano: eur(p.remaining),
      entro: g.target_date ?? undefined,
      al_mese: p.perMonth === null ? undefined : eur(p.perMonth),
      arrivo_previsto_mese: f?.eta ?? undefined,
      in_tempo: f?.onTime ?? undefined,
    };
  });
}

const strip = <T extends { _d?: unknown }>(m: T) => {
  const { _d, ...rest } = m;
  void _d;
  return rest;
};

// --- fatti per tipo di analisi ---------------------------------------------------

export function dailyFacts(input: FactsInput, date = input.today) {
  const month = monthOf(date);
  const m = monthFacts(input, month);
  const d = m._d;
  const cat = new Map(input.categories.map((c) => [c.id, c]));
  const sub = new Map(input.subcategories.map((s) => [s.id, s]));
  const day = input.txns.filter((t) => t.occurred_on === date && t.type !== "opening_balance");
  const lev = levers(input, d, month);
  return {
    period: { start: date, end: date },
    facts: {
      tipo: "analisi serale",
      oggi: date,
      giorno: {
        data: date,
        giorno_settimana: WEEKDAYS[weekdayOf(date)],
        spese: eur(day.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount_cents, 0)),
        movimenti: day.slice(0, 20).map((t) => ({
          tipo: t.type === "expense" ? undefined : t.type === "income" ? "entrata" : "investimento",
          categoria: cat.get(t.category_id)?.name,
          sottocategoria: t.subcategory_id ? sub.get(t.subcategory_id)?.name : undefined,
          euro: eur(t.amount_cents),
          nota: t.note ?? undefined,
        })),
        media_giornaliera_variabili: d.daily.today ? eur(d.daily.today.averageDaily) : undefined,
        puoi_spendere_al_giorno_fino_a_fine_mese: d.daily.today?.perDayLeft == null ? undefined : eur(d.daily.today.perDayLeft),
      },
      mese: strip(m),
      anomalie: anomalies(input, d, date, date).concat(
        d.daily.today && d.daily.today.averageDaily > 0 && d.daily.today.spent >= Math.max(2000, d.daily.today.averageDaily * 2)
          ? [{ tipo: "giornata_alta", spese: eur(d.daily.today.spent), media: eur(d.daily.today.averageDaily) }]
          : [],
      ),
      piccole_spese: smallFacts(input, month),
      obiettivi: goalsFacts(input),
      leve: lev,
    },
    levers: lev,
  };
}

/** Settimana da lunedì a domenica che termina prima di `today` (il report del lunedì guarda la precedente). */
export function weeklyFacts(input: FactsInput) {
  const end = addDays(input.today, -((weekdayOf(input.today) + 1) % 7 || 7)); // domenica scorsa
  const start = addDays(end, -6);
  const inRange = (t: InsightTxn, a: string, b: string) => t.occurred_on >= a && t.occurred_on <= b;
  const sum = (a: string, b: string, type: InsightTxn["type"]) =>
    input.txns.filter((t) => t.type === type && inRange(t, a, b)).reduce((s, t) => s + t.amount_cents, 0);
  const cat = new Map(input.categories.map((c) => [c.id, c]));
  const byCat = new Map<string, number>();
  for (const t of input.txns) if (t.type === "expense" && inRange(t, start, end)) byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.amount_cents);
  // Media delle 8 settimane precedenti, per categoria e totale.
  const prevWeeks = Array.from({ length: 8 }, (_, i) => [addDays(start, -7 * (i + 1)), addDays(end, -7 * (i + 1))] as const);
  const firstTxn = input.txns.reduce((m, t) => (t.occurred_on < m ? t.occurred_on : m), input.today);
  const validWeeks = prevWeeks.filter(([a]) => a >= firstTxn);
  const avgOf = (f: (a: string, b: string) => number) => (validWeeks.length ? validWeeks.reduce((s, [a, b]) => s + f(a, b), 0) / validWeeks.length : 0);
  const days = Array.from({ length: 7 }, (_, k) => addDays(start, k)).map((d) => ({
    giorno: WEEKDAYS[weekdayOf(d)],
    spese: eur(input.txns.filter((t) => t.type === "expense" && t.occurred_on === d).reduce((s, t) => s + t.amount_cents, 0)),
  }));
  const month = monthOf(input.today);
  const m = monthFacts(input, month);
  const lev = levers(input, m._d, month);
  return {
    period: { start, end },
    facts: {
      tipo: "report settimanale",
      oggi: input.today,
      settimana: {
        dal: start,
        al: end,
        spese: eur(sum(start, end, "expense")),
        entrate: eur(sum(start, end, "income")),
        investito: eur(sum(start, end, "investment")),
        media_spese_settimanali_8_settimane: validWeeks.length ? eur(avgOf((a, b) => sum(a, b, "expense"))) : undefined,
        settimana_precedente_spese: eur(sum(addDays(start, -7), addDays(end, -7), "expense")),
        movimenti: input.txns.filter((t) => t.type === "expense" && inRange(t, start, end)).length,
        per_giorno: days,
        per_categoria: [...byCat]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([id, v]) => ({
            nome: cat.get(id)?.name,
            speso: eur(v),
            media_settimanale: validWeeks.length
              ? eur(avgOf((a, b) => input.txns.filter((t) => t.type === "expense" && t.category_id === id && inRange(t, a, b)).reduce((s, t) => s + t.amount_cents, 0)))
              : undefined,
          })),
      },
      mese_in_corso: strip(m),
      anomalie: anomalies(input, m._d, start, end),
      piccole_spese: smallFacts(input, month),
      obiettivi: goalsFacts(input),
      leve: lev,
    },
    levers: lev,
  };
}

/** Mese chiuso: il report del primo del mese guarda il mese precedente. */
export function monthlyFacts(input: FactsInput) {
  const month = addMonths(monthOf(input.today), -1);
  const m = monthFacts(input, month);
  const d = m._d;
  const lev = levers(input, d, month);
  const start = `${month}-01`;
  const end = addDays(`${monthOf(input.today)}-01`, -1);
  const balance = balanceHistory(input.txns, input.today, input.checkpoints);
  return {
    period: { start, end },
    facts: {
      tipo: "report mensile",
      oggi: input.today,
      mese: strip(m),
      andamento_6_mesi: d.trend.slice(-6).map((p) => ({ mese: monthLabel(p.month), entrate: eur(p.income), spese: eur(p.expense), investito: eur(p.investment), risparmio_pct: pct(p.savingsRate) })),
      saldo_conto_stimato_oggi: eur(balance.current),
      anomalie: anomalies(input, d, start, end),
      piccole_spese: smallFacts(input, month),
      obiettivi: goalsFacts(input),
      leve: lev,
    },
    levers: lev,
  };
}

export function factsFor(kind: AnalysisKind, input: FactsInput) {
  return kind === "daily" ? dailyFacts(input) : kind === "weekly" ? weeklyFacts(input) : monthlyFacts(input);
}

// --- verifica delle cifre ------------------------------------------------------------

/** Tutti i numeri presenti nei fatti (ricorsivamente), per controllare il testo dell'AI. */
export function factNumbers(facts: unknown): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    // Valore assoluto: nel testo "-150 €" si legge 150 (il segno lo dà la frase).
    if (typeof v === "number") out.add(Math.abs(Math.round(v * 10) / 10));
    else if (typeof v === "string") for (const n of numbersIn(v)) out.add(n);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** "1.234 €", "12,5%", "300" → [1234, 12.5, 300] (formato italiano). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\w.,])(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?![\w])/g)) {
    out.push(Number(`${m[1].replace(/\./g, "")}${m[2] ? `.${m[2]}` : ""}`));
  }
  return out;
}

/**
 * Cifre nel testo che non compaiono nei fatti (con tolleranza di arrotondamento).
 * Esclude i numeri che sono parte di date, giorni o anni.
 */
export function unknownNumbers(text: string, known: Set<number>): number[] {
  const knownList = [...known];
  return numbersIn(text).filter((n) => {
    if (n <= 31 && Number.isInteger(n)) return false; // giorni, conteggi piccoli
    if (n >= 1900 && n <= 2100 && Number.isInteger(n)) return false; // anni
    return !knownList.some((k) => Math.abs(k - n) <= Math.max(1, Math.abs(k) * 0.005));
  });
}

// --- proiezione (per la chat: "posso permettermi…?") ---------------------------------

/**
 * Saldo previsto a fine `targetMonth`: saldo stimato di oggi + quanto si muoverà
 * ancora il mese in corso (entrate attese, spese e investimenti stimati non ancora registrati) +
 * risparmio netto medio dei mesi completi (entrate − spese − investimenti) per
 * ogni mese successivo. Con `spendEuro`, quanto resterebbe dopo quella spesa.
 */
export function projection(input: FactsInput, targetMonth: string, spendEuro?: number) {
  const current = monthOf(input.today);
  const balance = balanceHistory(input.txns, input.today, input.checkpoints);
  const m = monthFacts(input, current);
  const d = m._d;
  const remainingThisMonth = d.forecast
    ? d.forecast.income - d.totals.income - (d.forecast.expense - d.totals.expense) - (d.forecast.investment - d.totals.investment)
    : 0;
  const history = d.trend.filter((p) => p.month < current).slice(-6);
  // Risparmio netto medio con più peso ai mesi recenti (media esponenziale, metà peso ogni 3 mesi).
  const netAvg = ewma(history.map((p) => p.income - p.expense - p.investment), 3) ?? 0;
  const [ty, tm] = targetMonth.split("-").map(Number);
  const [cy, cm] = current.split("-").map(Number);
  const monthsAhead = Math.max(0, (ty - cy) * 12 + (tm - cm));
  const expected = balance.current + remainingThisMonth + netAvg * monthsAhead;
  const savedUntil = remainingThisMonth + netAvg * monthsAhead + (d.totals.income - d.totals.expense - d.totals.investment);
  const goals = goalsFacts(input).filter((g) => !g.entro || g.entro.slice(0, 7) <= targetMonth);
  const spend = spendEuro !== undefined ? Math.round(spendEuro * 100) : null;
  return {
    oggi: input.today,
    fino_a: monthLabel(targetMonth),
    mesi_completi_da_qui: monthsAhead,
    saldo_conto_oggi: eur(balance.current),
    saldo_basato_su: balance.anchor.kind === "checkpoint" ? `saldo reale del ${balance.anchor.date}` : balance.anchor.kind === "opening" ? "saldo iniziale dell'import" : "nessun saldo di partenza",
    movimento_previsto_resto_mese: eur(remainingThisMonth),
    risparmio_netto_medio_mensile: eur(netAvg),
    mesi_usati_per_la_media: history.length,
    saldo_previsto_fine_periodo: eur(expected),
    risparmio_previsto_da_inizio_mese: eur(savedUntil),
    obiettivi_in_scadenza: goals,
    spesa_ipotizzata: spend === null ? undefined : eur(spend),
    saldo_dopo_la_spesa: spend === null ? undefined : eur(expected - spend),
    quota_del_risparmio_previsto_pct: spend === null || savedUntil <= 0 ? undefined : pct(spend / savedUntil),
    attenzione: history.length < 3 ? "meno di 3 mesi completi di storia: proiezione poco affidabile" : undefined,
  };
}
