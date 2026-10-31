import type { AnalysisContent } from "@/lib/ai/analyze";
import { formatEuros } from "@/lib/format";

export type AnalysisRow = {
  id: string;
  kind: "daily" | "weekly" | "monthly";
  period_start: string;
  period_end: string;
  headline: string;
  content: AnalysisContent;
  model: string;
  cost_usd: number;
  created_at: string;
};

export const KIND_LABEL = { daily: "Analisi serale", weekly: "Report settimanale", monthly: "Report mensile" } as const;

const day = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const fmt = (d: string) => day.format(new Date(`${d}T00:00:00Z`));

export function periodLabel(a: Pick<AnalysisRow, "kind" | "period_start" | "period_end">) {
  if (a.kind === "daily") return fmt(a.period_start);
  if (a.kind === "weekly") return `${fmt(a.period_start)} – ${fmt(a.period_end)}`;
  return month.format(new Date(`${a.period_start}T00:00:00Z`));
}

/** Un'analisi: titolo, sintesi, punti, consigli con impatto calcolato dal codice. */
export function AnalysisCard({ a, compact = false }: { a: AnalysisRow; compact?: boolean }) {
  const c = a.content;
  return (
    <article className="card card-padded analysis">
      <div className="analysis-head">
        <span className="analysis-kind">{KIND_LABEL[a.kind]}</span>
        <span className="muted small">{periodLabel(a)}</span>
      </div>
      <h2 className="analysis-title">{a.headline}</h2>
      <p>{c.sintesi}</p>
      {!compact && (
        <>
          {c.punti.length > 0 && (
            <ul className="analysis-points">
              {c.punti.map((p, i) => (
                <li key={i}>
                  <strong>{p.titolo}</strong> {p.testo}
                </li>
              ))}
            </ul>
          )}
          {c.consigli.length > 0 && (
            <div className="tips">
              <span className="group-title tips-title">Consigli, per impatto</span>
              {c.consigli.map((t, i) => (
                <div key={i} className="tip">
                  <div className="tip-main">
                    <strong>{t.titolo}</strong>
                    <span>{t.azione}</span>
                    <span className="muted small">Calcolato su: {t.base}</span>
                  </div>
                  <div className="tip-impact">
                    <strong>{formatEuros(t.euro_mese * 100)}</strong>
                    <span className="muted small">al mese</span>
                    <span className="muted small">{formatEuros(t.euro_anno * 100)}/anno</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {c.dati_insufficienti && <p className="muted small">ℹ️ {c.dati_insufficienti}</p>}
          {c.verifica.numeri_non_trovati.length > 0 && (
            <p className="check-diff small">
              Attenzione: nel testo ci sono cifre che non risultano nei dati ({c.verifica.numeri_non_trovati.join(", ")}). Prendile con cautela.
            </p>
          )}
          <p className="muted small analysis-foot">
            {new Date(a.created_at).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" })} · {a.model} · {a.model.startsWith("gemini") ? "gratis" : `$${Number(a.cost_usd).toFixed(3)}`}
          </p>
        </>
      )}
    </article>
  );
}
