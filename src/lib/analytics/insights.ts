// Analisi aggiuntive: composizione, piccole spese, ricorrenti, saldo del conto,
// andamento per categoria, riepilogo annuale, tag, obiettivi, spese da ripetere.
// Funzioni pure in centesimi interi, testate in scripts/test-analytics.ts.
import { addDays, addMonths, monthOf, type AnalyticsCategory, type AnalyticsSubcategory } from "./dashboard.ts";

export type InsightTxn = {
  id?: string;
  occurred_on: string;
  type: "expense" | "income" | "investment" | "opening_balance";
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
  note?: string | null;
  tag?: string | null;
};

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

// --- colori stabili per categoria ---------------------------------------------------

export const COLOR_SLOTS = 7;

/**
 * Le 7 categorie di spesa più pesanti negli ultimi 12 mesi ricevono uno slot fisso
 * della palette (1–7); le altre finiscono in "Altro" (slot 0, grigio). Lo slot segue
 * la categoria, non la posizione nel mese: lo stesso colore indica sempre la stessa cosa.
 */
export function categoryColorSlots(txns: InsightTxn[], month: string): Map<string, number> {
  const from = addMonths(month, -11);
  const totals = new Map<string, number>();
  for (const t of txns) {
    const m = monthOf(t.occurred_on);
    if (t.type !== "expense" || m < from || m > month) continue;
    totals.set(t.category_id, (totals.get(t.category_id) ?? 0) + t.amount_cents);
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1]).slice(0, COLOR_SLOTS);
  return new Map(ranked.map(([id], i) => [id, i + 1]));
}

// --- composizione del mese --------------------------------------------------------

export type Slice = { id: string; name: string; emoji: string; amount: number; share: number; slot: number };

export function composition(
  txns: InsightTxn[],
  categories: AnalyticsCategory[],
  month: string,
  slots: Map<string, number>,
): { slices: Slice[]; total: number; other: { id: string; name: string; emoji: string; amount: number }[] } {
  const byCat = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "expense" || monthOf(t.occurred_on) !== month) continue;
    byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.amount_cents);
  }
  const total = [...byCat.values()].reduce((s, v) => s + v, 0);
  const cat = new Map(categories.map((c) => [c.id, c]));
  const slices: Slice[] = [];
  const other: { id: string; name: string; emoji: string; amount: number }[] = [];
  for (const [id, amount] of byCat) {
    const c = cat.get(id);
    const slot = slots.get(id) ?? 0;
    if (slot) slices.push({ id, name: c?.name ?? "?", emoji: c?.emoji ?? "•", amount, share: total ? amount / total : 0, slot });
    else other.push({ id, name: c?.name ?? "?", emoji: c?.emoji ?? "•", amount });
  }
  const otherTotal = other.reduce((s, o) => s + o.amount, 0);
  // In ordine di slot: le fette vicine seguono l'ordine validato della palette.
  slices.sort((a, b) => a.slot - b.slot);
  if (otherTotal > 0) slices.push({ id: "other", name: "Altre categorie", emoji: "⋯", amount: otherTotal, share: total ? otherTotal / total : 0, slot: 0 });
  other.sort((a, b) => b.amount - a.amount);
  return { slices, total, other };
}

// --- piccole spese ------------------------------------------------------------------

export const SMALL_SPEND_CENTS = 1000; // fino a 10 €

export type SmallSpend = {
  categoryId: string;
  subcategoryId: string | null;
  name: string;
  emoji: string;
  count: number; // nel mese
  total: number; // nel mese
  monthlyAverage: number; // media degli ultimi 3 mesi completi (o del mese, se non ci sono)
  yearly: number; // monthlyAverage × 12
};

export function smallSpends(
  txns: InsightTxn[],
  categories: AnalyticsCategory[],
  subcategories: AnalyticsSubcategory[],
  month: string,
): { items: SmallSpend[]; total: number; count: number } {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const sub = new Map(subcategories.map((s) => [s.id, s]));
  const fixed = new Set(categories.filter((c) => c.is_fixed).map((c) => c.id));
  const history = [1, 2, 3].map((i) => addMonths(month, -i));
  const firstMonth = txns.reduce((min, t) => (monthOf(t.occurred_on) < min ? monthOf(t.occurred_on) : min), month);
  const validHistory = history.filter((m) => m >= firstMonth);

  type Acc = { count: number; total: number; hist: number };
  const groups = new Map<string, Acc>();
  for (const t of txns) {
    if (t.type !== "expense" || t.amount_cents > SMALL_SPEND_CENTS || fixed.has(t.category_id)) continue;
    const m = monthOf(t.occurred_on);
    const inMonth = m === month;
    const inHist = validHistory.includes(m);
    if (!inMonth && !inHist) continue;
    const key = `${t.category_id}|${t.subcategory_id ?? ""}`;
    const g = groups.get(key) ?? { count: 0, total: 0, hist: 0 };
    if (inMonth) {
      g.count++;
      g.total += t.amount_cents;
    } else g.hist += t.amount_cents;
    groups.set(key, g);
  }

  const items: SmallSpend[] = [];
  for (const [key, g] of groups) {
    if (g.count < 3) continue; // "ricorrenti": almeno 3 volte nel mese
    const [categoryId, subId] = key.split("|");
    const c = cat.get(categoryId);
    const monthlyAverage = validHistory.length ? Math.round(g.hist / validHistory.length) : g.total;
    items.push({
      categoryId,
      subcategoryId: subId || null,
      name: (subId && sub.get(subId)?.name) || c?.name || "?",
      emoji: c?.emoji ?? "•",
      count: g.count,
      total: g.total,
      monthlyAverage,
      yearly: Math.max(monthlyAverage, g.total) * 12,
    });
  }
  items.sort((a, b) => b.total - a.total);
  return { items, total: items.reduce((s, i) => s + i.total, 0), count: items.reduce((s, i) => s + i.count, 0) };
}

// --- spese ricorrenti e abbonamenti ---------------------------------------------------

export type Recurring = {
  categoryId: string;
  subcategoryId: string | null;
  name: string;
  emoji: string;
  typical: number; // importo tipico (mediana)
  last: number;
  previous: number | null;
  changed: boolean; // l'ultimo importo differisce dal precedente di oltre il 5%
  months: number; // mesi con l'addebito negli ultimi 6
  yearly: number;
  lastDate: string;
  nextDate: string; // stima: stesso giorno del mese successivo
};

/**
 * Un addebito è "ricorrente" se compare in almeno 3 dei 6 mesi precedenti, circa
 * una volta al mese, con importi stabili (70% entro ±15% della mediana).
 * Esclude per costruzione le spese quotidiane come caffè e biglietti.
 */
export function recurring(
  txns: InsightTxn[],
  categories: AnalyticsCategory[],
  subcategories: AnalyticsSubcategory[],
  today: string,
): Recurring[] {
  const current = monthOf(today);
  const from = addMonths(current, -6);
  const cat = new Map(categories.map((c) => [c.id, c]));
  const sub = new Map(subcategories.map((s) => [s.id, s]));
  const groups = new Map<string, InsightTxn[]>();
  for (const t of txns) {
    const m = monthOf(t.occurred_on);
    if (t.type !== "expense" || m < from || m > current) continue;
    const key = `${t.category_id}|${t.subcategory_id ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const months = new Set(list.map((t) => monthOf(t.occurred_on)).filter((m) => m < current));
    if (months.size < 3) continue;
    const pastCount = list.filter((t) => monthOf(t.occurred_on) < current).length;
    if (pastCount / months.size > 1.5) continue; // più di una volta al mese: non è un abbonamento
    const amounts = list.map((t) => t.amount_cents);
    const typical = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - typical) <= typical * 0.15).length / amounts.length;
    if (stable < 0.7) continue;
    const sorted = [...list].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
    const last = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    const [categoryId, subId] = key.split("|");
    const c = cat.get(categoryId);
    const [y, mo, d] = last.occurred_on.split("-").map(Number);
    const next = new Date(Date.UTC(y, mo, Math.min(d, 28)));
    out.push({
      categoryId,
      subcategoryId: subId || null,
      name: (subId && sub.get(subId)?.name) || c?.name || "?",
      emoji: c?.emoji ?? "•",
      typical,
      last: last.amount_cents,
      previous: prev?.amount_cents ?? null,
      changed: prev !== null && Math.abs(last.amount_cents - prev.amount_cents) > prev.amount_cents * 0.05,
      months: months.size,
      yearly: typical * 12,
      lastDate: last.occurred_on,
      nextDate: next.toISOString().slice(0, 10),
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

// --- saldo del conto ----------------------------------------------------------------------

export type BalancePoint = { month: string; balance: number; net: number };

/**
 * Saldo stimato a fine mese: saldo iniziale + entrate − spese − investimenti
 * (i versamenti escono dal conto verso il broker).
 */
export function balanceHistory(txns: InsightTxn[], today: string): { points: BalancePoint[]; opening: { date: string; amount: number } | null; current: number } {
  const opening = txns.filter((t) => t.type === "opening_balance").sort((a, b) => a.occurred_on.localeCompare(b.occurred_on))[0];
  const rest = txns.filter((t) => t.type !== "opening_balance");
  if (!rest.length && !opening) return { points: [], opening: null, current: 0 };
  const first = opening ? monthOf(opening.occurred_on) : rest.reduce((m, t) => (monthOf(t.occurred_on) < m ? monthOf(t.occurred_on) : m), monthOf(today));
  const net = new Map<string, number>();
  for (const t of rest) {
    const m = monthOf(t.occurred_on);
    const sign = t.type === "income" ? 1 : -1;
    net.set(m, (net.get(m) ?? 0) + sign * t.amount_cents);
  }
  let balance = opening?.amount_cents ?? 0;
  const points = monthsBetween(first, monthOf(today)).map((m) => {
    const n = net.get(m) ?? 0;
    balance += n;
    return { month: m, balance, net: n };
  });
  return { points, opening: opening ? { date: opening.occurred_on, amount: opening.amount_cents } : null, current: balance };
}

// --- andamento per categoria ------------------------------------------------------------

export type CategoryTrend = {
  id: string;
  name: string;
  emoji: string;
  isFixed: boolean;
  values: { month: string; amount: number }[];
  average: number; // media dei mesi precedenti a quello indicato
  current: number;
  delta: number; // current − average
};

export function categoryTrends(txns: InsightTxn[], categories: AnalyticsCategory[], month: string, months = 12): CategoryTrend[] {
  const first = txns.reduce((min, t) => (monthOf(t.occurred_on) < min ? monthOf(t.occurred_on) : min), month);
  const span = monthsBetween(addMonths(month, -(months - 1)) < first ? first : addMonths(month, -(months - 1)), month);
  const by = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== "expense") continue;
    const k = `${t.category_id}|${monthOf(t.occurred_on)}`;
    by.set(k, (by.get(k) ?? 0) + t.amount_cents);
  }
  return categories
    .filter((c) => c.kind === "expense")
    .map((c) => {
      const values = span.map((m) => ({ month: m, amount: by.get(`${c.id}|${m}`) ?? 0 }));
      const prev = values.slice(0, -1);
      const average = prev.length ? Math.round(prev.reduce((s, v) => s + v.amount, 0) / prev.length) : 0;
      const current = values[values.length - 1]?.amount ?? 0;
      return { id: c.id, name: c.name, emoji: c.emoji, isFixed: c.is_fixed, values, average, current, delta: current - average };
    })
    .filter((t) => t.values.some((v) => v.amount > 0))
    .sort((a, b) => b.average + b.current - (a.average + a.current));
}

// --- riepilogo dell'anno ------------------------------------------------------------------

export type YearSummary = {
  year: number;
  months: { month: string; income: number; expense: number; investment: number; savingsRate: number | null }[];
  totals: { income: number; expense: number; investment: number; savingsRate: number | null };
  best: { month: string; savingsRate: number } | null;
  worst: { month: string; savingsRate: number } | null;
  topCategories: { id: string; name: string; emoji: string; amount: number; share: number }[];
  previous: { income: number; expense: number; investment: number; savingsRate: number | null; months: number } | null;
  tags: { tag: string; amount: number }[];
  monthsWithData: number;
};

const rate = (income: number, expense: number) => (income > 0 ? (income - expense) / income : null);

export function yearSummary(txns: InsightTxn[], categories: AnalyticsCategory[], year: number): YearSummary {
  const y = String(year);
  const py = String(year - 1);
  const months = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
  const agg = new Map(months.map((m) => [m, { income: 0, expense: 0, investment: 0 }]));
  const prev = { income: 0, expense: 0, investment: 0 };
  const prevMonths = new Set<string>();
  const byCat = new Map<string, number>();
  const byTag = new Map<string, number>();
  for (const t of txns) {
    if (t.type === "opening_balance") continue;
    const ty = t.occurred_on.slice(0, 4);
    if (ty === y) {
      agg.get(monthOf(t.occurred_on))![t.type] += t.amount_cents;
      if (t.type === "expense") {
        byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.amount_cents);
        if (t.tag) byTag.set(t.tag, (byTag.get(t.tag) ?? 0) + t.amount_cents);
      }
    } else if (ty === py) {
      prev[t.type] += t.amount_cents;
      prevMonths.add(monthOf(t.occurred_on));
    }
  }
  const rows = months.map((m) => {
    const a = agg.get(m)!;
    return { month: m, ...a, savingsRate: rate(a.income, a.expense) };
  });
  const withData = rows.filter((r) => r.income || r.expense || r.investment);
  const totals = withData.reduce((s, r) => ({ income: s.income + r.income, expense: s.expense + r.expense, investment: s.investment + r.investment }), {
    income: 0,
    expense: 0,
    investment: 0,
  });
  const rated = withData.filter((r) => r.savingsRate !== null) as (typeof rows[number] & { savingsRate: number })[];
  const best = rated.length ? rated.reduce((a, b) => (b.savingsRate > a.savingsRate ? b : a)) : null;
  const worst = rated.length ? rated.reduce((a, b) => (b.savingsRate < a.savingsRate ? b : a)) : null;
  const cat = new Map(categories.map((c) => [c.id, c]));
  const topCategories = [...byCat]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, amount]) => ({ id, name: cat.get(id)?.name ?? "?", emoji: cat.get(id)?.emoji ?? "•", amount, share: totals.expense ? amount / totals.expense : 0 }));
  return {
    year,
    months: rows,
    totals: { ...totals, savingsRate: rate(totals.income, totals.expense) },
    best: best && { month: best.month, savingsRate: best.savingsRate },
    worst: worst && withData.length > 1 ? { month: worst.month, savingsRate: worst.savingsRate } : null,
    topCategories,
    previous: prevMonths.size ? { ...prev, savingsRate: rate(prev.income, prev.expense), months: prevMonths.size } : null,
    tags: [...byTag].map(([tag, amount]) => ({ tag, amount })).sort((a, b) => b.amount - a.amount),
    monthsWithData: withData.length,
  };
}

// --- viaggi ed eventi (tag) -----------------------------------------------------------

export type TagSummary = {
  tag: string;
  total: number;
  count: number;
  from: string;
  to: string;
  days: number;
  perDay: number;
  categories: { id: string; name: string; emoji: string; amount: number }[];
};

export function tagSummaries(txns: InsightTxn[], categories: AnalyticsCategory[]): TagSummary[] {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const groups = new Map<string, InsightTxn[]>();
  for (const t of txns) {
    if (!t.tag || t.type !== "expense") continue;
    groups.set(t.tag, [...(groups.get(t.tag) ?? []), t]);
  }
  return [...groups]
    .map(([tag, list]) => {
      const dates = list.map((t) => t.occurred_on).sort();
      const from = dates[0];
      const to = dates[dates.length - 1];
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
      const total = list.reduce((s, t) => s + t.amount_cents, 0);
      const byCat = new Map<string, number>();
      for (const t of list) byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.amount_cents);
      return {
        tag,
        total,
        count: list.length,
        from,
        to,
        days,
        perDay: Math.round(total / days),
        categories: [...byCat]
          .map(([id, amount]) => ({ id, name: cat.get(id)?.name ?? "?", emoji: cat.get(id)?.emoji ?? "•", amount }))
          .sort((a, b) => b.amount - a.amount),
      };
    })
    .sort((a, b) => b.to.localeCompare(a.to));
}

// --- obiettivi di risparmio --------------------------------------------------------------

export type Goal = { id: string; name: string; emoji: string; target_cents: number; saved_cents: number; target_date: string | null };

export function goalProgress(goal: Goal, today: string) {
  const remaining = Math.max(0, goal.target_cents - goal.saved_cents);
  let monthsLeft: number | null = null;
  if (goal.target_date) {
    const [ty, tm] = goal.target_date.split("-").map(Number);
    const [cy, cm] = today.split("-").map(Number);
    // Mesi di accantonamento che restano: da ottobre a dicembre sono 2 (novembre e dicembre).
    monthsLeft = Math.max(1, (ty - cy) * 12 + (tm - cm));
  }
  return {
    ratio: goal.target_cents ? Math.min(1, goal.saved_cents / goal.target_cents) : 0,
    remaining,
    monthsLeft,
    perMonth: monthsLeft ? Math.ceil(remaining / monthsLeft) : null,
    done: remaining === 0,
    overdue: goal.target_date !== null && goal.target_date < today && remaining > 0,
  };
}

// --- spese da ripetere ------------------------------------------------------------------

export type RepeatCandidate = {
  key: string;
  type: "expense" | "income" | "investment";
  category_id: string;
  subcategory_id: string | null;
  amount_cents: number;
  note: string | null;
  count: number;
  last: string;
};

/** Combinazioni identiche (categoria, sottocategoria, importo, nota) usate almeno 3 volte negli ultimi 90 giorni. */
export function repeatCandidates(txns: InsightTxn[], today: string, limit = 4): RepeatCandidate[] {
  const since = addDays(today, -90);
  const groups = new Map<string, RepeatCandidate>();
  for (const t of txns) {
    if (t.type === "opening_balance" || t.occurred_on < since || t.occurred_on > today) continue;
    const note = t.note?.trim() || null;
    const key = `${t.type}|${t.category_id}|${t.subcategory_id ?? ""}|${t.amount_cents}|${note ?? ""}`;
    const g = groups.get(key) ?? {
      key,
      type: t.type,
      category_id: t.category_id,
      subcategory_id: t.subcategory_id,
      amount_cents: t.amount_cents,
      note,
      count: 0,
      last: t.occurred_on,
    };
    g.count++;
    if (t.occurred_on > g.last) g.last = t.occurred_on;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.count >= 3)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, limit);
}
