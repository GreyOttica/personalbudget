import type { CategoryRow, Dashboard } from "./dashboard.ts";

/**
 * Segnali sul budget del mese in corso, calcolati dal codice:
 * - "projection": al ritmo attuale la categoria sforerà il budget (ma oggi è ancora sotto l'80%)
 * - "warning": superato l'80% del budget
 * - "over": budget superato
 * La chiave serve a non mandare due volte la stessa notifica nello stesso mese.
 */
export type BudgetSignal = {
  key: string;
  level: "projection" | "warning" | "over";
  categoryId: string;
  name: string;
  emoji: string;
  spent: number;
  budget: number;
  forecast: number | null;
  /** probabilità di sforare (dalla simulazione), se disponibile */
  probOver: number | null;
  /** quanto si può ancora spendere al giorno fino a fine mese (centesimi), se resta qualcosa */
  perDayLeft: number | null;
  daysLeft: number;
};

/** Dal giorno 5 in poi: prima la stima per categoria è troppo incerta. */
export const PROJECTION_MIN_DAY = 5;
/** Sforamento minimo previsto per avvisare: 5% del budget e almeno 10 €. */
const MIN_OVERSHOOT_RATIO = 0.05;
const MIN_OVERSHOOT_CENTS = 1000;

export function budgetSignals(d: Pick<Dashboard, "categories" | "isCurrentMonth" | "day" | "daysInMonth" | "month">): BudgetSignal[] {
  if (!d.isCurrentMonth) return [];
  const daysLeft = d.daysInMonth - d.day + 1; // oggi compreso
  const out: BudgetSignal[] = [];
  for (const c of d.categories) {
    if (!c.budget || (c.isFixed && c.status !== "over")) continue; // le fisse avvisano solo se superate
    const base = {
      categoryId: c.id,
      name: c.name,
      emoji: c.emoji,
      spent: c.spent,
      budget: c.budget,
      forecast: c.forecast,
      probOver: c.probOver ?? null,
      daysLeft,
      perDayLeft: c.spent < c.budget ? Math.floor((c.budget - c.spent) / daysLeft) : null,
    };
    if (c.status === "over") out.push({ ...base, key: `over:${c.id}:${d.month}`, level: "over" });
    else if (c.status === "warning") out.push({ ...base, key: `warning:${c.id}:${d.month}`, level: "warning" });
    else if (willOvershoot(c, d.day)) out.push({ ...base, key: `projection:${c.id}:${d.month}`, level: "projection" });
  }
  const rank = { over: 0, warning: 1, projection: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level] || overshoot(b) - overshoot(a));
}

/** Con la simulazione basta una probabilità di sforare del 65%; senza, si usa la stima puntuale. */
export const PROJECTION_MIN_PROBABILITY = 0.65;

function willOvershoot(c: CategoryRow, day: number) {
  if (c.forecast === null || !c.budget || day < PROJECTION_MIN_DAY) return false;
  if (c.probOver != null && c.probOver < PROJECTION_MIN_PROBABILITY) return false;
  const extra = c.forecast - c.budget;
  return extra >= Math.max(MIN_OVERSHOOT_CENTS, c.budget * MIN_OVERSHOOT_RATIO);
}

const overshoot = (s: BudgetSignal) => (s.forecast ?? s.spent) - s.budget;

const eur = (cents: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" }).format(Math.round(cents / 100));

/** Testo della notifica / dell'avviso, in italiano. */
export function signalText(s: BudgetSignal): { title: string; body: string } {
  const left = s.perDayLeft !== null ? ` Restano ${eur(s.budget - s.spent)} per ${s.daysLeft} ${s.daysLeft === 1 ? "giorno" : "giorni"}: circa ${eur(s.perDayLeft)} al giorno.` : "";
  if (s.level === "over")
    return { title: `${s.emoji} ${s.name}: budget superato`, body: `${eur(s.spent)} su ${eur(s.budget)} (+${eur(s.spent - s.budget)}).` };
  if (s.level === "warning")
    return {
      title: `${s.emoji} ${s.name}: oltre l'80% del budget`,
      body: `${eur(s.spent)} su ${eur(s.budget)} (${Math.round((s.spent / s.budget) * 100)}%).${left}`,
    };
  const prob = s.probOver != null ? ` Probabilità di sforare: ${s.probOver > 0.95 ? "oltre il 95" : Math.round(s.probOver * 100)}%.` : "";
  return {
    title: `${s.emoji} ${s.name}: così sforerai il budget`,
    body: `Al ritmo attuale arriverai a ${eur(s.forecast ?? s.spent)} su ${eur(s.budget)} (+${eur((s.forecast ?? s.spent) - s.budget)}).${prob}${left}`,
  };
}
