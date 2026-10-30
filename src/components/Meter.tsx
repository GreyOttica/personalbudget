import type { BudgetStatus } from "@/lib/analytics/dashboard";

/**
 * Barra di avanzamento del budget. Il riempimento porta la gravità (accento →
 * avviso → critico); la traccia è un passo più chiaro della stessa scala.
 * Un trattino opzionale segna la stima di fine mese.
 */
export function Meter({ ratio, status, forecastRatio, label }: { ratio: number; status: BudgetStatus; forecastRatio?: number | null; label: string }) {
  const pct = Math.min(1, Math.max(0, ratio)) * 100;
  const f = forecastRatio === null || forecastRatio === undefined ? null : Math.min(1, Math.max(0, forecastRatio)) * 100;
  return (
    <div
      className={`meter meter-${status}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <div className="meter-fill" style={{ width: `${pct}%` }} />
      {f !== null && f > pct && <div className="meter-forecast" style={{ left: `${f}%` }} aria-hidden />}
    </div>
  );
}

const STATUS_TEXT: Record<BudgetStatus, string> = {
  none: "",
  ok: "Nel budget",
  warning: "Oltre l'80%",
  over: "Budget superato",
};

/** Lo stato non è mai affidato al solo colore: icona + testo. */
export function StatusLabel({ status, text }: { status: BudgetStatus; text?: string }) {
  if (status === "none") return null;
  const icon = status === "ok" ? "✓" : status === "warning" ? "!" : "✕";
  return (
    <span className={`status status-${status}`}>
      <span className="status-icon" aria-hidden>
        {icon}
      </span>
      {text ?? STATUS_TEXT[status]}
    </span>
  );
}
