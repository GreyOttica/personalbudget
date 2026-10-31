import type { AnalyticsCategory, Dashboard } from "./dashboard.ts";

/** Una proposta di nuovi budget: l'AI sceglie gli importi, qui si calcolano le conseguenze. Funzione pura. */
export type ProposalItem = { category_id: string; name: string; emoji: string; from_cents: number | null; to_cents: number; average_cents: number; fixed: boolean };
export type ProposalSummary = {
  budget_totale_attuale: number;
  budget_totale_proposto: number;
  differenza_mensile: number;
  media_entrate: number;
  spesa_media_attuale: number;
  /** spesa se rispetti i nuovi budget (categorie senza budget: la loro media) */
  spesa_prevista_con_proposta: number;
  risparmio_mensile_previsto: number;
  risparmio_pct_previsto: number | null;
  risparmio_pct_medio_attuale: number | null;
  avvisi: string[];
};

const eur = (c: number) => Math.round(c / 100);
const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);

export function buildProposal(
  d: Pick<Dashboard, "categories" | "averages">,
  categories: AnalyticsCategory[],
  changes: { categoryId: string; cents: number }[],
): { items: ProposalItem[]; summary: ProposalSummary } {
  const row = new Map(d.categories.map((c) => [c.id, c]));
  const change = new Map(changes.map((c) => [c.categoryId, c.cents]));
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const avvisi: string[] = [];
  const items: ProposalItem[] = [];
  let current = 0;
  let proposed = 0;
  let expected = 0;

  for (const c of expenseCats) {
    const r = row.get(c.id);
    const from = r?.budget ?? null;
    const average = r?.average ?? 0;
    const to = change.has(c.id) ? change.get(c.id)! : from;
    current += from ?? 0;
    proposed += to ?? 0;
    expected += to ?? average; // senza budget conta la media
    if (change.has(c.id) && to !== from) {
      items.push({ category_id: c.id, name: c.name, emoji: c.emoji, from_cents: from, to_cents: to!, average_cents: average, fixed: c.is_fixed });
      if (c.is_fixed && to! < average * 0.95) avvisi.push(`${c.name} è una spesa fissa: un budget di ${eur(to!)} € è sotto quanto spendi di solito (${eur(average)} €).`);
      else if (!c.is_fixed && average > 0 && to! < average * 0.5)
        avvisi.push(`${c.name}: ${eur(to!)} € è meno della metà della tua media (${eur(average)} €), taglio molto difficile da rispettare.`);
    }
  }
  const income = d.averages.income;
  const saving = income - expected;
  if (d.averages.months < 3) avvisi.push(`Solo ${d.averages.months} mesi di storico: le medie sono poco affidabili.`);
  return {
    items: items.sort((a, b) => b.to_cents - (b.from_cents ?? 0) - (a.to_cents - (a.from_cents ?? 0))),
    summary: {
      budget_totale_attuale: eur(current),
      budget_totale_proposto: eur(proposed),
      differenza_mensile: eur(proposed - current),
      media_entrate: eur(income),
      spesa_media_attuale: eur(d.averages.expense),
      spesa_prevista_con_proposta: eur(expected),
      risparmio_mensile_previsto: eur(saving),
      risparmio_pct_previsto: pct(income > 0 ? saving / income : null),
      risparmio_pct_medio_attuale: pct(d.averages.savingsRate),
      avvisi,
    },
  };
}
