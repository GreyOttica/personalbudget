// Import idempotente dello storico dal Google Sheet esportato in XLSX.
//
//   node scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx --dry-run
//   node --env-file=.env.local scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx
//   node scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx --json > rows.json
//
// Senza --dry-run invia le righe alla funzione SQL import_sheet_rows (con la
// service role key, quindi solo dal tuo computer) e poi confronta il riepilogo
// mensile calcolato dal database con quello calcolato qui e con il foglio "EU".
import { Workbook, serialToDate, serialToLocalIso, type Cell } from "./lib/xlsx.ts";

const LOG_SHEET = "Log EntrateUscite";
const EU_SHEET = "EU";

type SheetRow = {
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

type MonthTotals = {
  income: number;
  expense: number;
  fixed: number;
  investment: number;
  count: number;
  // Ricostruzione del foglio EU: somma con segno per categoria e mese, poi
  // entrate = categorie positive, uscite = categorie negative. Le righe senza
  // segno non entrano nella pivot.
  euByCategory: Map<string, number>;
  unsigned: number;
};

const FIXED = new Set(["Affitto", "Abbonamenti"]);
const INVESTMENT_CATEGORY = "Investimenti";
const SALARY_CATEGORY = "Stipendio";
// Versamento mensile in investimenti registrato in Altro senza nota.
const MONTHLY_INVESTMENT_CENTS = 20_000;

// --- utilità -------------------------------------------------------------------

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const pct = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric", timeZone: "UTC" });

const cents = (n: number) => Math.round(n * 100);
const fmt = (c: number) => eur.format(c / 100);
const monthLabel = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`));

function str(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function categoryName(label: string): string {
  return label.replace(/^\S+\s+/, "").trim();
}

// Stesse regole di public.import_sheet_rows: se ne cambi una, cambia anche l'altra.
function classify(r: SheetRow): Classified {
  const note = (r.note ?? "").toLowerCase();
  const cat = categoryName(r.category);
  if (r.pivot === null) return { type: "skip", category: cat };
  if (note.includes("valore iniziale")) return { type: "opening_balance", category: cat };
  if (r.pivot > 0) {
    return { type: "income", category: cat === "Altro" && note.includes("stipendio") ? SALARY_CATEGORY : cat };
  }
  if (cat === INVESTMENT_CATEGORY) return { type: "investment", category: cat };
  if (cat === "Altro" && (note.includes("investiment") || (r.note === null && cents(r.amount) === MONTHLY_INVESTMENT_CENTS))) {
    return { type: "investment", category: INVESTMENT_CATEGORY };
  }
  return { type: "expense", category: cat };
}

// --- lettura del foglio -------------------------------------------------------

function readLog(wb: Workbook): SheetRow[] {
  const sheet = wb.sheet(LOG_SHEET);
  const header = sheet.get(1);
  if (!header) throw new Error(`Intestazione mancante in "${LOG_SHEET}"`);

  const col = new Map<string, number>();
  for (const [c, v] of header) if (typeof v === "string") col.set(v.trim(), c);
  const need = (name: string) => {
    const c = col.get(name);
    if (c === undefined) throw new Error(`Colonna "${name}" non trovata in "${LOG_SHEET}"`);
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
  if (problems.length) throw new Error(`Problemi nel foglio:\n  ${problems.join("\n  ")}`);
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

// --- riepilogo locale -----------------------------------------------------------

function summarize(rows: SheetRow[]): Map<string, MonthTotals> {
  const months = new Map<string, MonthTotals>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (!months.has(m)) {
      months.set(m, { income: 0, expense: 0, fixed: 0, investment: 0, count: 0, euByCategory: new Map(), unsigned: 0 });
    }
    const t = months.get(m)!;
    const amount = cents(r.amount);
    const { type, category } = classify(r);

    if (r.pivot === null) t.unsigned += amount;
    else t.euByCategory.set(r.category, (t.euByCategory.get(r.category) ?? 0) + cents(r.pivot));

    if (type === "opening_balance" || type === "skip") continue;
    t.count++;
    if (type === "income") t.income += amount;
    else if (type === "investment") t.investment += amount;
    else {
      t.expense += amount;
      if (FIXED.has(category)) t.fixed += amount;
    }
  }
  return new Map([...months].sort(([a], [b]) => a.localeCompare(b)));
}

function euFromLog(t: MonthTotals): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const v of t.euByCategory.values()) {
    if (v > 0) income += v;
    else expense -= v;
  }
  return { income, expense };
}

function printTable(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

// --- Supabase --------------------------------------------------------------------

type DbMonth = {
  month: string;
  income_cents: number;
  expense_cents: number;
  fixed_expense_cents: number;
  investment_cents: number;
  txn_count: number;
};

async function supabase<T>(path: string, init: RequestInit): Promise<T> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Imposta SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status} su ${path}: ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

// --- main ------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (!file) {
    console.error("Uso: node scripts/import-sheet.ts <file.xlsx> [--dry-run] [--json]");
    process.exit(1);
  }

  const wb = new Workbook(file);
  const rows = readLog(wb);

  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(rows));
    return;
  }

  const months = summarize(rows);
  const opening = rows.filter((r) => classify(r).type === "opening_balance");
  const unsigned = rows.filter((r) => r.pivot === null);
  console.log(`\nFile: ${file}`);
  console.log(`Righe lette: ${rows.length}  (dal ${rows.map((r) => r.date).sort()[0]} al ${rows.map((r) => r.date).sort().at(-1)})`);
  console.log(`Saldo iniziale escluso: ${opening.map((r) => `${fmt(cents(r.amount))} (${r.date})`).join(", ") || "nessuno"}`);
  console.log(`Righe senza segno ignorate: ${unsigned.length} per ${fmt(unsigned.reduce((s, r) => s + cents(r.amount), 0))}`);
  const moved = rows.filter((r) => categoryName(r.category) !== classify(r).category);
  for (const r of moved) {
    console.log(`Spostata in ${classify(r).category}: ${r.date} ${fmt(cents(r.amount))} ${r.note ?? "(senza nota)"}`);
  }

  // 1) Riepilogo mensile secondo le regole dell'app.
  console.log("\nRiepilogo mensile (regole dell'app: investimenti separati dalle spese)\n");
  printTable(
    ["Mese", "Entrate", "Spese", "di cui fisse", "Investimenti", "Risparmio %", "Movimenti"],
    [...months].map(([m, t]) => [
      monthLabel(m),
      fmt(t.income),
      fmt(t.expense),
      fmt(t.fixed),
      fmt(t.investment),
      t.income > 0 ? pct.format((t.income - t.expense) / t.income) : "—",
      String(t.count),
    ]),
  );

  // 2) Controllo con il foglio EU.
  const eu = readEu(wb);
  if (!eu) {
    console.log(`\nFoglio "${EU_SHEET}" non trovato: controllo saltato.`);
  } else {
    console.log(`\nControllo con il foglio "${EU_SHEET}" (lì gli investimenti sono tra le uscite)\n`);
    let allMatch = true;
    const table = [...months].map(([m, t], i) => {
      const rebuilt = euFromLog(t);
      const euIn = eu.income[i] ?? 0;
      const euOut = eu.expense[i] ?? 0;
      const ok = rebuilt.income === euIn && rebuilt.expense === euOut;
      allMatch &&= ok;
      // Differenza tra le uscite dell'app (spese + investimenti) e quelle di EU:
      // compensazioni tra entrate e uscite registrate nella stessa categoria.
      const netting = t.expense + t.investment - euOut;
      return [
        monthLabel(m),
        fmt(euIn),
        fmt(euOut),
        ok ? "✓" : `✗ (${fmt(rebuilt.income)} / ${fmt(rebuilt.expense)})`,
        fmt(netting),
      ];
    });
    printTable(["Mese", "EU entrate", "EU uscite", "Ricostruzione", "Compensazioni"], table);
    console.log(
      allMatch
        ? "\n✓ Il foglio EU coincide al centesimo con lo storico letto. Le differenze rispetto all'app sono\n" +
            "  solo le compensazioni: la pivot somma per categoria, quindi in Altro le spese si sottraggono\n" +
            "  da stipendi e rimborsi registrati nella stessa categoria. Il saldo del mese è identico."
        : "\n✗ Il foglio EU non coincide con lo storico: controlla i mesi segnati.",
    );
  }

  if (dryRun) {
    console.log("\n--dry-run: nessuna scrittura sul database.");
    return;
  }

  // 3) Import nel database e verifica del riepilogo calcolato da Postgres.
  console.log("\nImport in Supabase…");
  const stats = await supabase<Record<string, number>>("rpc/import_sheet_rows", {
    method: "POST",
    body: JSON.stringify({ p_rows: rows }),
  });
  console.log(stats);

  const db = await supabase<DbMonth[]>("monthly_summary?select=*&order=month", { method: "GET" });
  const dbByMonth = new Map(db.map((d) => [d.month.slice(0, 7), d]));
  let dbMatch = true;
  for (const [m, t] of months) {
    const d = dbByMonth.get(m);
    const ok =
      d !== undefined &&
      Number(d.income_cents) === t.income &&
      Number(d.expense_cents) === t.expense &&
      Number(d.fixed_expense_cents) === t.fixed &&
      Number(d.investment_cents) === t.investment;
    if (!ok) {
      dbMatch = false;
      console.log(`✗ ${monthLabel(m)}: database ${JSON.stringify(d)} ≠ file`);
    }
  }
  console.log(dbMatch ? "✓ Il riepilogo del database coincide con il file." : "✗ Differenze tra database e file (vedi sopra).");
  if (stats.missing_in_sheet > 0) {
    console.log(`Nota: ${stats.missing_in_sheet} movimenti importati in passato non sono più nel foglio (non li ho cancellati).`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
