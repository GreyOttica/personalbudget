// Suggerimenti per inserire più in fretta, imparati dal tuo storico (sul telefono, anche offline).
// Funzioni pure, testate in scripts/test-analytics.ts.

export type SuggestTxn = {
  occurred_on: string;
  type: string;
  amount_cents: number;
  category_id: string;
  subcategory_id: string | null;
  note?: string | null;
};

export type Habit = {
  key: string;
  type: "expense" | "income" | "investment";
  category_id: string;
  subcategory_id: string | null;
  note: string | null;
  /** importo più frequente (a parità, il più recente) */
  amount_cents: number;
  count: number;
  last: string;
  score: number;
};

const WINDOW_DAYS = 180;
const HALF_LIFE_DAYS = 45;

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** minuscole e senza accenti: "Caffè" e "caffe" sono la stessa cosa */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Abitudini: combinazioni (categoria, sottocategoria, nota) degli ultimi 180 giorni, con un punteggio
 * che conta quante volte e quanto di recente (metà peso ogni 45 giorni). Per ognuna l'importo tipico.
 */
export function habits(txns: SuggestTxn[], today: string): Habit[] {
  const groups = new Map<string, { h: Habit; amounts: Map<number, { w: number; last: string }> }>();
  for (const t of txns) {
    if (t.type === "opening_balance") continue;
    const age = dayDiff(today, t.occurred_on);
    if (age < 0 || age > WINDOW_DAYS) continue;
    const note = t.note?.trim() || null;
    const key = `${t.type}|${t.category_id}|${t.subcategory_id ?? ""}|${note ? normalize(note) : ""}`;
    const w = 0.5 ** (age / HALF_LIFE_DAYS);
    let g = groups.get(key);
    if (!g) {
      g = {
        h: { key, type: t.type as Habit["type"], category_id: t.category_id, subcategory_id: t.subcategory_id, note, amount_cents: t.amount_cents, count: 0, last: t.occurred_on, score: 0 },
        amounts: new Map(),
      };
      groups.set(key, g);
    }
    g.h.count++;
    g.h.score += w;
    if (t.occurred_on > g.h.last) {
      g.h.last = t.occurred_on;
      if (note) g.h.note = note; // la grafia più recente
    }
    const a = g.amounts.get(t.amount_cents) ?? { w: 0, last: t.occurred_on };
    a.w += w;
    if (t.occurred_on > a.last) a.last = t.occurred_on;
    g.amounts.set(t.amount_cents, a);
  }
  return [...groups.values()]
    .map(({ h, amounts }) => {
      const best = [...amounts].sort((x, y) => y[1].w - x[1].w || y[1].last.localeCompare(x[1].last))[0];
      return { ...h, amount_cents: best[0] };
    })
    .sort((a, b) => b.score - a.score || b.last.localeCompare(a.last));
}

/**
 * Le spese abituali da salvare in un tocco: almeno 3 volte, niente spese fisse né importi sopra i 100 €
 * (un tocco solo deve essere innocuo).
 */
export function favorites(txns: SuggestTxn[], today: string, fixedCategoryIds: Set<string>, limit = 5): Habit[] {
  return habits(txns, today)
    .filter((h) => h.type === "expense" && h.count >= 3 && !fixedCategoryIds.has(h.category_id) && h.amount_cents <= 10_000)
    .slice(0, limit);
}

export type Named = { id: string; name: string };

/**
 * Ricerca mentre scrivi: la parola cercata all'inizio di una parola di nota, sottocategoria o categoria.
 * "esse" → "Esselunga · Supermercato", "benz" → "Auto › Benzina".
 */
export function search(
  query: string,
  txns: SuggestTxn[],
  today: string,
  categories: Named[],
  subcategories: Named[],
  limit = 6,
): Habit[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const words = q.split(" ");
  const cat = new Map(categories.map((c) => [c.id, normalize(c.name)]));
  const sub = new Map(subcategories.map((s) => [s.id, normalize(s.name)]));
  const matches = (text: string) => {
    const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);
    return words.every((w) => tokens.some((t) => t.startsWith(w)));
  };
  return habits(txns, today)
    .filter((h) => {
      const text = [h.note ? normalize(h.note) : "", h.subcategory_id ? (sub.get(h.subcategory_id) ?? "") : "", cat.get(h.category_id) ?? ""].join(" ");
      return matches(text);
    })
    .slice(0, limit);
}

/** Importi tipici per una categoria (e sottocategoria): i 3 più frequenti di recente. */
export function typicalAmounts(txns: SuggestTxn[], today: string, categoryId: string, subcategoryId: string | null, limit = 3): number[] {
  const w = new Map<number, number>();
  for (const t of txns) {
    if (t.category_id !== categoryId || (subcategoryId && t.subcategory_id !== subcategoryId)) continue;
    const age = dayDiff(today, t.occurred_on);
    if (age < 0 || age > WINDOW_DAYS) continue;
    w.set(t.amount_cents, (w.get(t.amount_cents) ?? 0) + 0.5 ** (age / HALF_LIFE_DAYS));
  }
  return [...w]
    .filter(([, x]) => x >= 0.9) // almeno circa una volta di recente
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([c]) => c);
}
