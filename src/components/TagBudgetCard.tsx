import { Meter } from "@/components/Meter";
import type { TagBudgetStatus } from "@/lib/analytics/tags";
import { formatEuros } from "@/lib/format";

const fmtEnd = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" });

/** Budget del viaggio: speso, residuo, quanto al giorno fino alla fine. */
export function TagBudgetCard({ s, title = false }: { s: TagBudgetStatus; title?: boolean }) {
  return (
    <section className="card card-padded tag-budget">
      <div className="cost-row">
        <span>{title ? <strong>🏷️ {s.tag}</strong> : "Budget"}</span>
        <span>
          <strong>{formatEuros(s.spent)}</strong> <span className="muted">su {formatEuros(s.budget)}</span>
        </span>
      </div>
      <Meter ratio={s.ratio} status={s.level} label={`${s.tag}: speso rispetto al budget`} />
      <p className={`small ${s.level === "over" ? "check-diff" : s.level === "warning" ? "warn-text" : "muted"}`}>
        {s.left >= 0 ? `Restano ${formatEuros(s.left)}` : `Superato di ${formatEuros(-s.left)}`}
        {s.daysLeft !== null && s.endsOn ? ` · fino al ${fmtEnd.format(new Date(`${s.endsOn}T00:00:00Z`))}, ${s.daysLeft} ${s.daysLeft === 1 ? "giorno" : "giorni"}` : ""}
        {s.perDayLeft !== null ? ` · ${formatEuros(s.perDayLeft)} al giorno` : ""}
      </p>
    </section>
  );
}
