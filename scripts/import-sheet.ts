// Import idempotente dello storico da riga di comando (alternativa alla pagina /import).
//
//   node scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx --dry-run
//   node --env-file=.env.local scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx
//   node scripts/import-sheet.ts data/Personal_Budget_v_2.xlsx --json > rows.json
//
// Senza --dry-run invia le righe alla funzione SQL import_sheet_rows con la
// secret key e poi confronta il riepilogo mensile del database con quello del file.
import { readFileSync } from "node:fs";
import { buildReport, compareWithDb, type DbMonth, type ImportStats } from "../src/lib/import/sheet.ts";

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const pct = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric", timeZone: "UTC" });

const fmt = (c: number) => eur.format(c / 100);
const monthLabel = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`));

function printTable(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

async function supabase<T>(path: string, init: RequestInit): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Imposta NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY in .env.local");
  // Le secret key (sb_secret_…) vanno solo nell'header apikey; le legacy
  // service_role key sono JWT e vanno anche in Authorization.
  const auth: Record<string, string> = key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {};
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, ...auth, "Content-Type": "application/json", ...init.headers },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status} su ${path}: ${body}`);
  return (body ? JSON.parse(body) : null) as T;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Uso: node scripts/import-sheet.ts <file.xlsx> [--dry-run] [--json]");
    process.exit(1);
  }

  const report = buildReport(readFileSync(file));
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(report.rows));
    return;
  }

  console.log(`\nFile: ${file}`);
  console.log(`Righe lette: ${report.rows.length}  (dal ${report.firstDate} al ${report.lastDate})`);
  console.log(`Saldo iniziale escluso: ${report.opening.map((o) => `${fmt(o.amount)} (${o.date})`).join(", ") || "nessuno"}`);
  console.log(`Righe senza segno ignorate: ${report.unsigned.count} per ${fmt(report.unsigned.amount)}`);
  for (const m of report.moved) console.log(`Spostata in ${m.to}: ${m.date} ${fmt(m.amount)} ${m.note ?? "(senza nota)"}`);
  for (const t of report.investmentTaxes) console.log(`Tassa sugli investimenti contata come spesa: ${t.date} ${fmt(t.amount)}`);

  console.log("\nRiepilogo mensile (investimenti separati dalle spese)\n");
  printTable(
    ["Mese", "Entrate", "Spese", "di cui fisse", "Investimenti", "Risparmio %", "Movimenti"],
    report.months.map((m) => [
      monthLabel(m.month),
      fmt(m.income),
      fmt(m.expense),
      fmt(m.fixed),
      fmt(m.investment),
      m.income > 0 ? pct.format((m.income - m.expense) / m.income) : "—",
      String(m.count),
    ]),
  );

  if (!report.euFound) {
    console.log('\nFoglio "EU" non trovato: controllo saltato.');
  } else {
    console.log('\nControllo con il foglio "EU" (lì gli investimenti sono tra le uscite)\n');
    printTable(
      ["Mese", "EU entrate", "EU uscite", "Ricostruzione", "Compensazioni"],
      report.months.map((m) => [
        monthLabel(m.month),
        fmt(m.eu!.income),
        fmt(m.eu!.expense),
        m.eu!.matches ? "✓" : "✗",
        fmt(m.eu!.netting),
      ]),
    );
    console.log(
      report.euAllMatch
        ? "\n✓ Il foglio EU coincide al centesimo con lo storico letto. Le differenze rispetto all'app sono\n" +
            "  solo le compensazioni: la pivot somma per categoria, quindi in Altro le spese si sottraggono\n" +
            "  da stipendi e rimborsi registrati nella stessa categoria. Il saldo del mese è identico."
        : "\n✗ Il foglio EU non coincide con lo storico: controlla i mesi segnati.",
    );
  }

  if (args.includes("--dry-run")) {
    console.log("\n--dry-run: nessuna scrittura sul database.");
    return;
  }

  console.log("\nImport in Supabase…");
  const stats = await supabase<ImportStats>("rpc/import_sheet_rows", {
    method: "POST",
    body: JSON.stringify({ p_rows: report.rows }),
  });
  console.log(stats);

  const db = await supabase<DbMonth[]>("monthly_summary?select=*&order=month", { method: "GET" });
  const mismatched = compareWithDb(report, db);
  console.log(
    mismatched.length
      ? `✗ Differenze tra database e file in: ${mismatched.map(monthLabel).join(", ")} (normale se hai già inserito movimenti dall'app)`
      : "✓ Il riepilogo del database coincide con il file.",
  );
  if (stats.missing_in_sheet > 0) {
    console.log(`Nota: ${stats.missing_in_sheet} movimenti importati in passato non sono più nel foglio (non li ho cancellati).`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
