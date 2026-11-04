// Budget per un tag (viaggio o evento). Funzioni pure, testate in scripts/test-analytics.ts.

export type TagBudget = { tag: string; amount_cents: number; ends_on: string | null };
export type TagSpend = { occurred_on: string; type: string; amount_cents: number; tag?: string | null };

export type TagBudgetStatus = {
  tag: string;
  budget: number;
  spent: number;
  left: number;
  ratio: number;
  level: "ok" | "warning" | "over";
  endsOn: string | null;
  /** giorni da oggi (compreso) alla fine, se la fine è oggi o dopo */
  daysLeft: number | null;
  /** quanto si può spendere al giorno fino alla fine per restare nel budget */
  perDayLeft: number | null;
  lastSpend: string | null;
  /** in corso: fine non ancora passata, oppure spese negli ultimi 7 giorni (senza fine) */
  active: boolean;
};

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function tagBudgetStatus(b: TagBudget, txns: TagSpend[], today: string): TagBudgetStatus {
  let spent = 0;
  let last: string | null = null;
  for (const t of txns) {
    if (t.type !== "expense" || t.tag !== b.tag) continue;
    spent += t.amount_cents;
    if (!last || t.occurred_on > last) last = t.occurred_on;
  }
  const ratio = b.amount_cents ? spent / b.amount_cents : 0;
  const daysLeft = b.ends_on && b.ends_on >= today ? days(b.ends_on, today) + 1 : null;
  const left = b.amount_cents - spent;
  return {
    tag: b.tag,
    budget: b.amount_cents,
    spent,
    left,
    ratio,
    level: ratio > 1 ? "over" : ratio >= 0.8 ? "warning" : "ok",
    endsOn: b.ends_on,
    daysLeft,
    perDayLeft: daysLeft && left > 0 ? Math.floor(left / daysLeft) : null,
    lastSpend: last,
    active: b.ends_on ? b.ends_on >= today && (last !== null || days(b.ends_on, today) <= 60) : last !== null && days(today, last) <= 7,
  };
}
