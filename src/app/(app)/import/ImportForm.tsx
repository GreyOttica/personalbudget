"use client";

import { useActionState } from "react";
import { formatCents, formatMonth, formatPercent } from "@/lib/format";
import { runImport, type ImportState } from "./actions";

const initial: ImportState = { status: "idle" };

const monthLabel = (m: string) => formatMonth(`${m}-01`);
const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function ImportForm() {
  const [state, action, pending] = useActionState(runImport, initial);

  return (
    <>
      <form action={action} className="stack">
        <label className="field">
          <span>File Excel</span>
          <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        </label>
        <div className="button-row">
          <button type="submit" name="mode" value="preview" className="button button-secondary" disabled={pending}>
            Anteprima
          </button>
          <button type="submit" name="mode" value="import" className="button" disabled={pending}>
            Importa
          </button>
        </div>
        {pending && <p className="muted">Elaborazione in corso…</p>}
      </form>

      {state.status === "error" && <p className="alert stack">{state.message}</p>}
      {state.status === "done" && <Result state={state} />}
    </>
  );
}

function Result({ state }: { state: Extract<ImportState, { status: "done" }> }) {
  const { report, stats, dbMismatches } = state;

  return (
    <section>
      {state.mode === "import" && stats && (
        <>
          <h2>Import completato</h2>
          <div className="card card-padded">
            <ul className="plain-list">
              <li>Nuovi movimenti: {stats.inserted}</li>
              <li>Aggiornati: {stats.updated}</li>
              <li>Già presenti e invariati: {stats.unchanged}</li>
              <li>Senza segno, ignorati: {stats.skipped_unsigned}</li>
              {stats.missing_in_sheet > 0 && (
                <li>Importati in passato ma non più nel foglio (non cancellati): {stats.missing_in_sheet}</li>
              )}
            </ul>
            <p className={dbMismatches?.length ? "alert" : "ok"}>
              {dbMismatches?.length
                ? `Il database non coincide con il file in: ${dbMismatches.map(monthLabel).join(", ")}. È normale solo se hai già inserito movimenti dall'app.`
                : "✓ Il riepilogo del database coincide al centesimo con il file."}
            </p>
          </div>
        </>
      )}
      {state.mode === "preview" && (
        <p className="muted stack">Anteprima: nessun dato è stato scritto. Se i numeri ti tornano, premi Importa.</p>
      )}

      <h2>Cosa ho letto</h2>
      <div className="card card-padded">
        <ul className="plain-list">
          <li>
            {report.rowCount} righe dal {shortDate(report.firstDate)} al {shortDate(report.lastDate)}
          </li>
          {report.opening.map((o) => (
            <li key={o.date}>
              Saldo iniziale escluso: {formatCents(o.amount)} ({shortDate(o.date)})
            </li>
          ))}
          <li>
            Righe senza segno ignorate: {report.unsigned.count} per {formatCents(report.unsigned.amount)}
          </li>
          {report.investmentTaxes.map((t) => (
            <li key={t.date}>
              Tassa sugli investimenti contata come spesa: {formatCents(t.amount)} ({shortDate(t.date)})
            </li>
          ))}
        </ul>
        {report.moved.length > 0 && (
          <details>
            <summary>Righe spostate di categoria ({report.moved.length})</summary>
            <ul className="plain-list">
              {report.moved.map((m, i) => (
                <li key={i}>
                  {shortDate(m.date)} · {formatCents(m.amount)} · {m.note ?? "senza nota"} → {m.to}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <h2>Riepilogo mensile</h2>
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
            {report.months.map((m) => {
              const rate = m.income > 0 ? (m.income - m.expense) / m.income : null;
              return (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td>{formatCents(m.income)}</td>
                  <td>{formatCents(m.expense)}</td>
                  <td>{formatCents(m.fixed)}</td>
                  <td>{formatCents(m.investment)}</td>
                  <td className={rate === null ? "" : rate < 0 ? "negative" : "positive"}>
                    {rate === null ? "—" : formatPercent(rate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Controllo con il foglio EU</h2>
      {!report.euFound ? (
        <p className="muted">Foglio &quot;EU&quot; non trovato nel file: controllo saltato.</p>
      ) : (
        <>
          <p className={report.euAllMatch ? "ok" : "alert"}>
            {report.euAllMatch
              ? "✓ Il foglio EU coincide al centesimo con lo storico. Le differenze rispetto all'app sono solo compensazioni: il foglio somma per categoria, quindi in Altro le spese si sottraggono da stipendi e rimborsi. Il saldo del mese è identico."
              : "✗ Il foglio EU non coincide con lo storico nei mesi segnati."}
          </p>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Mese</th>
                  <th>EU entrate</th>
                  <th>EU uscite</th>
                  <th>Verifica</th>
                  <th>Compensazioni</th>
                </tr>
              </thead>
              <tbody>
                {report.months.map((m) => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td>{formatCents(m.eu!.income)}</td>
                    <td>{formatCents(m.eu!.expense)}</td>
                    <td className={m.eu!.matches ? "positive" : "negative"}>{m.eu!.matches ? "✓" : "✗"}</td>
                    <td>{formatCents(m.eu!.netting)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
