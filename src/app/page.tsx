import Link from "next/link";
import { formatCents, formatMonth, formatPercent } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type MonthRow = {
  month: string;
  income_cents: number;
  expense_cents: number;
  fixed_expense_cents: number;
  investment_cents: number;
  txn_count: number;
  savings_rate: number | null;
};

// Fase 1: pagina di verifica. Mostra il riepilogo mensile letto con la sessione
// dell'utente, quindi passando da RLS. Verrà sostituita dalla dashboard (Fase 3).
export default async function Home() {
  const supabase = await createClient();
  const [{ data: claims }, { data: months, error }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase
      .from("monthly_summary_rates")
      .select("month, income_cents, expense_cents, fixed_expense_cents, investment_cents, txn_count, savings_rate")
      .order("month", { ascending: false })
      .returns<MonthRow[]>(),
  ]);
  const email = typeof claims?.claims?.email === "string" ? claims.claims.email : "";

  return (
    <main className="page">
      <div className="header">
        <div>
          <h1>Personal Budget</h1>
          <p className="muted">{email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="link-button">
            Esci
          </button>
        </form>
      </div>

      <nav className="nav-links">
        <Link href="/import">Import storico</Link>
      </nav>

      <h2>Riepilogo mensile</h2>
      {error ? (
        <p className="alert">Errore nel caricamento: {error.message}</p>
      ) : !months?.length ? (
        <p className="muted">
          Nessun movimento ancora. Vai su <Link href="/import">Import storico</Link> e carica il file Excel. Se
          l&apos;hai già fatto, controlla di aver registrato il tuo utente come proprietario (passo 5 della guida).
        </p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Mese</th>
                <th>Entrate</th>
                <th>Spese</th>
                <th>di cui fisse</th>
                <th>Investimenti</th>
                <th>Risparmio</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <td>{formatMonth(m.month)}</td>
                  <td>{formatCents(Number(m.income_cents))}</td>
                  <td>{formatCents(Number(m.expense_cents))}</td>
                  <td>{formatCents(Number(m.fixed_expense_cents))}</td>
                  <td>{formatCents(Number(m.investment_cents))}</td>
                  <td className={m.savings_rate === null ? "" : m.savings_rate < 0 ? "negative" : "positive"}>
                    {m.savings_rate === null ? "—" : formatPercent(Number(m.savings_rate))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
