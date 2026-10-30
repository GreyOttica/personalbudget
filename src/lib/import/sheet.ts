// Lettura e classificazione dello storico dal Google Sheet esportato in XLSX.
// Usato sia dallo script da riga di comando sia dalla pagina /import.
// Le regole di classificazione sono le stesse di public.import_sheet_rows:
// se ne cambi una, cambia anche l'altra.
import { Workbook, serialToDate, serialToLocalIso, type Cell } from "./xlsx.ts";

const LOG_SHEET = "Log EntrateUscite";
const EU_SHEET = "EU";

export type SheetRow = {
  key: string;
  date: string;
  category: string;
  subcategory: string | null;
  pivot: number | null;
  amount: number;
  note: string | null;
  from: string | null;
  to: string | null;
  tag: string | null;
};

type TxnType = "expense" | "income" | "investment" | "opening_balance";
type Classified = { type: TxnType | "skip"; category: string };

/** Totali di un mese in centesimi. I campi eu* esistono solo se il foglio EU è presente. */
export type MonthReport = {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  fixed: number;
  investment: number;
  count: number;
  eu?: {
    income: number;
    expense: number;
    matches: boolean; // la ricostruzione della pivot dallo storico coincide con EU
    netting: number; // compensazioni tra entrate e uscite nella stessa categoria
  };
};

export type ImportReport = {
  rows: SheetRow[];
  firstDate: string;
  lastDate: string;
  opening: { date: string; amount: number }[];
  unsigned: { count: number; amount: number };
  moved: { date: string; amount: number; note: string | null; to: string }[];
  investmentTaxes: { date: string; amount: number }[];
  months: MonthReport[];
  euFound: boolean;
  euAllMatch: boolean;
};

const FIXED = new Set(["Affitto", "Abbonamenti"]);
const INVESTMENT_CATEGORY = "Investimenti";
const SALARY_CATEGORY = "Stipendio";
// Versamento mensile in investimenti (uno al mese) registrato in Altro senza nota.
const MONTHLY_INVESTMENT_CENTS = 20_000;

export const cents = (n: number) => Math.round(n * 100);

function str(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function categoryName(label: string): string {
  return label.replace(/^\S+\s+/, "").trim();
}

function isInvestmentTax(r: SheetRow): boolean {
  return categoryName(r.category) === INVESTMENT_CATEGORY && r.subcategory === "Tasse";
}

function isExplicitInvestment(r: SheetRow): boolean {
  if (r.pivot === null || r.pivot > 0 || isInvestmentTax(r)) return false;
  const cat = categoryName(r.category);
  return cat === INVESTMENT_CATEGORY || (cat === "Altro" && (r.note ?? "").toLowerCase().includes("investiment"));
}

/** Mesi (YYYY-MM) che hanno già un investimento dichiarato in modo esplicito. */
function monthsWithInvestment(rows: SheetRow[]): Set<string> {
  return new Set(rows.filter(isExplicitInvestment).map((r) => r.date.slice(0, 7)));
}

function classify(r: SheetRow, investedMonths: Set<string>): Classified {
  const note = (r.note ?? "").toLowerCase();
  const cat = categoryName(r.category);
  if (r.pivot === null) return { type: "skip", category: cat };
  if (note.includes("valore iniziale")) return { type: "opening_balance", category: cat };
  if (r.pivot > 0) {
    return { type: "income", category: cat === "Altro" && note.includes("stipendio") ? SALARY_CATEGORY : cat };
  }
  if (isInvestmentTax(r)) return { type: "expense", category: cat };
  if (isExplicitInvestment(r)) return { type: "investment", category: INVESTMENT_CATEGORY };
  if (
    cat === "Altro" &&
    r.note === null &&
    cents(r.amount) === MONTHLY_INVESTMENT_CENTS &&
    !investedMonths.has(r.date.slice(0, 7))
  ) {
    return { type: "investment", category: INVESTMENT_CATEGORY };
  }
  return { type: "expense", category: cat };
}

// --- lettura del foglio -------------------------------------------------------

function readLog(wb: Workbook): SheetRow[] {
  const sheet = wb.sheet(LOG_SHEET);
  const header = sheet.get(1);
  if (!header) throw new Error(`Intestazione mancante nel foglio "${LOG_SHEET}"`);

  const col = new Map<string, number>();
  for (const [c, v] of header) if (typeof v === "string") col.set(v.trim(), c);
  const need = (name: string) => {
    const c = col.get(name);
    if (c === undefined) throw new Error(`Colonna "${name}" non trovata nel foglio "${LOG_SHEET}"`);
    return c;
  };
  const C = {
    ts: need("Informazioni cronologiche"),
    date: need("Data"),
    category: need("Categoria"),
    sub: need("Sottocategoria"),
    pivot: need("Importo per pivot E/U"),
    amount: need("Importo"),
    note: need("Note"),
    from: need("Da"),
    to: need("A"),
    tag: need("Tag"),
  };

  const out: SheetRow[] = [];
  const problems: string[] = [];
  for (const [r, cells] of [...sheet].sort((a, b) => a[0] - b[0])) {
    if (r === 1) continue;
    const ts = cells.get(C.ts);
    const date = cells.get(C.date);
    const category = str(cells.get(C.category));
    const amount = cells.get(C.amount);
    if (ts === undefined && date === undefined && category === null) continue; // riga vuota

    if (typeof ts !== "number" || typeof date !== "number" || category === null || typeof amount !== "number") {
      problems.push(`riga ${r}: timestamp, data, categoria o importo mancanti/non validi`);
      continue;
    }
    const pivot = cells.get(C.pivot);
    const row: SheetRow = {
      key: serialToLocalIso(ts),
      date: serialToDate(date),
      category,
      subcategory: str(cells.get(C.sub)),
      pivot: typeof pivot === "number" ? pivot : null,
      amount,
      note: str(cells.get(C.note)),
      from: str(cells.get(C.from)),
      to: str(cells.get(C.to)),
      tag: str(cells.get(C.tag)),
    };
    if (row.pivot !== null && cents(Math.abs(row.pivot)) !== cents(row.amount)) {
      problems.push(`riga ${r}: |Importo per pivot| ${row.pivot} diverso da Importo ${row.amount}`);
    }
    out.push(row);
  }
  if (problems.length) throw new Error(`Problemi nel foglio:\n${problems.join("\n")}`);
  if (!out.length) throw new Error(`Nessuna riga trovata nel foglio "${LOG_SHEET}"`);
  return out;
}

/** Righe "Entrate"/"Uscite" del foglio EU: una colonna per mese a partire da C. */
function readEu(wb: Workbook): { income: number[]; expense: number[] } | null {
  if (!wb.sheetNames().includes(EU_SHEET)) return null;
  const sheet = wb.sheet(EU_SHEET);
  let income: number[] | null = null;
  let expense: number[] | null = null;
  for (const cells of sheet.values()) {
    const label = str(cells.get(1));
    if (label !== "Entrate" && label !== "Uscite") continue;
    const values: number[] = [];
    for (let c = 3; cells.has(c); c++) {
      const v = cells.get(c);
      values.push(typeof v === "number" ? cents(Math.abs(v)) : 0);
    }
    if (label === "Entrate") income = values;
    else expense = values;
  }
  return income && expense ? { income, expense } : null;
}

// --- riepilogo ---------------------------------------------------------------------

export function buildReport(data: Buffer): ImportReport {
  const wb = new Workbook(data);
  const rows = readLog(wb);
  const invested = monthsWithInvestment(rows);

  type Acc = Omit<MonthReport, "month" | "eu"> & { euByCategory: Map<string, number> };
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    let t = acc.get(m);
    if (!t) {
      t = { income: 0, expense: 0, fixed: 0, investment: 0, count: 0, euByCategory: new Map() };
      acc.set(m, t);
    }
    const amount = cents(r.amount);
    const { type, category } = classify(r, invested);

    // Ricostruzione del foglio EU: somma con segno per categoria e mese, poi
    // entrate = categorie positive, uscite = categorie negative.
    if (r.pivot !== null) t.euByCategory.set(r.category, (t.euByCategory.get(r.category) ?? 0) + cents(r.pivot));

    if (type === "opening_balance" || type === "skip") continue;
    t.count++;
    if (type === "income") t.income += amount;
    else if (type === "investment") t.investment += amount;
    else {
      t.expense += amount;
      if (FIXED.has(category)) t.fixed += amount;
    }
  }

  const eu = readEu(wb);
  const months: MonthReport[] = [...acc]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { euByCategory, ...t }], i) => {
      if (!eu) return { month, ...t };
      let rebuiltIncome = 0;
      let rebuiltExpense = 0;
      for (const v of euByCategory.values()) {
        if (v > 0) rebuiltIncome += v;
        else rebuiltExpense -= v;
      }
      const income = eu.income[i] ?? 0;
      const expense = eu.expense[i] ?? 0;
      return {
        month,
        ...t,
        eu: {
          income,
          expense,
          matches: rebuiltIncome === income && rebuiltExpense === expense,
          netting: t.expense + t.investment - expense,
        },
      };
    });

  const dates = rows.map((r) => r.date).sort();
  const unsigned = rows.filter((r) => r.pivot === null);
  return {
    rows,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    opening: rows
      .filter((r) => classify(r, invested).type === "opening_balance")
      .map((r) => ({ date: r.date, amount: cents(r.amount) })),
    unsigned: { count: unsigned.length, amount: unsigned.reduce((s, r) => s + cents(r.amount), 0) },
    moved: rows.flatMap((r) => {
      const to = classify(r, invested).category;
      return to === categoryName(r.category) ? [] : [{ date: r.date, amount: cents(r.amount), note: r.note, to }];
    }),
    investmentTaxes: rows.filter(isInvestmentTax).map((r) => ({ date: r.date, amount: cents(r.amount) })),
    months,
    euFound: eu !== null,
    euAllMatch: eu !== null && months.every((m) => m.eu?.matches),
  };
}

// --- confronto con il database --------------------------------------------------

export type DbMonth = {
  month: string;
  income_cents: number | string;
  expense_cents: number | string;
  fixed_expense_cents: number | string;
  investment_cents: number | string;
};

/** Mesi del file il cui riepilogo nel database non coincide (vuoto = tutto ok). */
export function compareWithDb(report: ImportReport, db: DbMonth[]): string[] {
  const byMonth = new Map(db.map((d) => [d.month.slice(0, 7), d]));
  return report.months
    .filter((m) => {
      const d = byMonth.get(m.month);
      return (
        !d ||
        Number(d.income_cents) !== m.income ||
        Number(d.expense_cents) !== m.expense ||
        Number(d.fixed_expense_cents) !== m.fixed ||
        Number(d.investment_cents) !== m.investment
      );
    })
    .map((m) => m.month);
}

export type ImportStats = {
  rows_in_file: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped_unsigned: number;
  new_categories: number;
  new_subcategories: number;
  missing_in_sheet: number;
};
