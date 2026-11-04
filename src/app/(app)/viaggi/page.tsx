import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadAll } from "@/lib/analytics/loadAll";
import { tagSummaries } from "@/lib/analytics/insights";
import { formatEuros } from "@/lib/format";
import { tagBudgetStatus } from "@/lib/analytics/tags";
import { TagBudgetCard } from "@/components/TagBudgetCard";
import { romeDate } from "@/lib/entry/amount";
import { EditTagBudget, NewTagBudget } from "./TagBudgetEditor";

export const metadata: Metadata = { title: "Viaggi ed eventi" };

const day = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (d: string) => day.format(new Date(`${d}T00:00:00Z`));

export default async function TagsPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const { txns, categories, tagBudgets } = await loadAll();
  const today = romeDate();
  const tags = tagSummaries(txns, categories);
  const budgets = new Map(tagBudgets.map((b) => [b.tag, b]));
  const status = new Map(tagBudgets.map((b) => [b.tag, tagBudgetStatus(b, txns, today)]));
  const open = tags.find((t) => t.tag === tag);
  // Budget per un viaggio ancora senza spese: pagina con solo il budget.
  const planned = !open && tag && budgets.has(tag) ? tag : null;

  if (planned) {
    const st = status.get(planned)!;
    return (
      <main className="page">
        <PageHeader title={planned} back="/viaggi" backLabel="Viaggi ed eventi" />
        <TagBudgetCard s={st} />
        <EditTagBudget tag={planned} initial={budgets.get(planned)!} />
      </main>
    );
  }

  if (open) {
    const max = Math.max(...open.categories.map((c) => c.amount));
    return (
      <main className="page">
        <PageHeader title={open.tag} back="/viaggi" backLabel="Viaggi ed eventi" />
        <section className="card hero">
          <p className="hero-label">Totale</p>
          <p className="hero-value">{formatEuros(open.total)}</p>
          <p className="muted">
            {fmtDay(open.from)} → {fmtDay(open.to)} · {open.days} {open.days === 1 ? "giorno" : "giorni"} · {formatEuros(open.perDay)} al giorno ·{" "}
            {open.count} movimenti
          </p>
        </section>
        {status.has(open.tag) && <TagBudgetCard s={status.get(open.tag)!} />}
        <EditTagBudget tag={open.tag} initial={budgets.get(open.tag) ?? null} />
        <ul className="card card-padded hbars">
          {open.categories.map((c) => (
            <li key={c.id} className="hbar">
              <div className="hbar-line">
                <span>
                  {c.emoji} {c.name}
                </span>
                <span className="hbar-value">{formatEuros(c.amount)}</span>
              </div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${(c.amount / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Per aggiungere spese a questo viaggio scegli il tag &quot;{open.tag}&quot; all&apos;ultimo passo del nuovo movimento.
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <PageHeader title="Viaggi ed eventi" subtitle="Le spese con un tag, raggruppate: quanto è costato ogni viaggio o evento." />
      {tagBudgets.length > 0 && (
        <>
          <h2 className="group-title">Budget</h2>
          {tagBudgets.map((b) => (
            <Link key={b.tag} href={`/viaggi?tag=${encodeURIComponent(b.tag)}`} className="tag-budget-link">
              <TagBudgetCard s={status.get(b.tag)!} title />
            </Link>
          ))}
        </>
      )}
      <NewTagBudget tags={tags.map((t) => t.tag)} />
      {tags.length > 0 && <h2 className="group-title">Tutti i tag</h2>}
      {tags.length === 0 ? (
        <p className="muted">Nessun tag ancora. Aggiungilo all&apos;ultimo passo del nuovo movimento, per esempio &quot;Lisbona - 2026&quot;.</p>
      ) : (
        <ul className="card menu">
          {tags.map((t) => (
            <li key={t.tag}>
              <Link href={`/viaggi?tag=${encodeURIComponent(t.tag)}`} className="menu-row">
                <span className="menu-icon" aria-hidden>
                  🏷️
                </span>
                <span className="menu-main">
                  <strong>{t.tag}</strong>
                  <span className="muted small">
                    {fmtDay(t.from)} · {t.days} {t.days === 1 ? "giorno" : "giorni"} · {formatEuros(t.perDay)} al giorno
                  </span>
                </span>
                <strong>{formatEuros(t.total)}</strong>
                <span className="chevron" aria-hidden>
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

