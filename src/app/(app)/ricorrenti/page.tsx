import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { recurring } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { formatCents, formatEuros } from "@/lib/format";

export const metadata: Metadata = { title: "Ricorrenti e abbonamenti" };

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default async function RecurringPage() {
  const { txns, categories, subcategories } = await loadAll();
  const today = romeDate();
  const items = recurring(txns, categories, subcategories, today);
  const monthly = items.reduce((s, i) => s + i.typical, 0);
  return (
    <main className="page">
      <PageHeader title="Ricorrenti e abbonamenti" subtitle="Addebiti che tornano ogni mese con un importo simile, riconosciuti dagli ultimi 6 mesi." />
      {items.length === 0 ? (
        <p className="muted">Nessun addebito ricorrente riconosciuto per ora: servono almeno 3 mesi.</p>
      ) : (
        <>
          <section className="card hero">
            <p className="hero-label">Costo fisso ricorrente</p>
            <p className="hero-value">{formatEuros(monthly)}</p>
            <p className="muted">al mese · {formatEuros(monthly * 12)} l&apos;anno</p>
          </section>
          <ul className="card cat-list">
            {items.map((r) => (
              <li key={`${r.categoryId}|${r.subcategoryId}`} className="cat-row">
                <span className="cat-emoji" aria-hidden>
                  {r.emoji}
                </span>
                <div className="cat-main">
                  <div className="cat-line">
                    <span className="cat-name">{r.name}</span>
                    <span className="cat-amount">{formatCents(r.typical)}</span>
                  </div>
                  <span className="muted small">
                    {r.months} mesi su 6 · ultimo {shortDate(r.lastDate)} · prossimo verso il {shortDate(r.nextDate)} · {formatEuros(r.yearly)} l&apos;anno
                  </span>
                  {r.changed && r.previous !== null && (
                    <span className="status status-warning">
                      <span className="status-icon" aria-hidden>
                        !
                      </span>
                      Importo cambiato: da {formatCents(r.previous)} a {formatCents(r.last)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
