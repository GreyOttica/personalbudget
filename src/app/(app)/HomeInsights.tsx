"use client";

import { useState } from "react";
import { Donut, Sankey, slotColor, type FlowNode } from "@/components/charts/more";
import type { CategoryRow, Dashboard, SubcategoryRow } from "@/lib/analytics/dashboard";
import type { Slice, SmallSpend } from "@/lib/analytics/insights";
import { formatEuros, formatPercent } from "@/lib/format";

// --- composizione ----------------------------------------------------------------

export function Composition({
  slices,
  total,
  other,
  subcategories,
}: {
  slices: Slice[];
  total: number;
  other: { id: string; name: string; emoji: string; amount: number }[];
  subcategories: SubcategoryRow[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!total) return <p className="muted">Nessuna spesa in questo mese.</p>;

  const sel = slices.find((s) => s.id === selected) ?? null;
  const detail =
    sel === null
      ? []
      : sel.id === "other"
        ? other.map((o) => ({ key: o.id, name: `${o.emoji} ${o.name}`, amount: o.amount }))
        : subcategories.filter((s) => s.categoryId === sel.id).map((s) => ({ key: `${s.id}`, name: `${s.name} · ${s.count}×`, amount: s.amount }));
  const max = Math.max(1, ...detail.map((d) => d.amount));

  return (
    <div className="card card-padded composition">
      <div className="composition-top">
        <Donut
          slices={slices.map((s) => ({ id: s.id, label: `${s.name}: ${formatEuros(s.amount)}`, value: s.amount, slot: s.slot }))}
          selected={selected}
          onSelect={setSelected}
          size={170}
          center={
            sel ? (
              <>
                <span className="donut-emoji" aria-hidden>
                  {sel.emoji}
                </span>
                <strong>{formatEuros(sel.amount)}</strong>
                <span className="muted small">{formatPercent(sel.share)}</span>
              </>
            ) : (
              <>
                <span className="muted small">Totale</span>
                <strong>{formatEuros(total)}</strong>
              </>
            )
          }
        />
        <ul className="donut-legend">
          {slices.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={selected === s.id ? "selected" : ""}
                onClick={() => setSelected(selected === s.id ? null : s.id)}
                aria-pressed={selected === s.id}
              >
                <span className="swatch" style={{ background: slotColor(s.slot) }} aria-hidden />
                <span className="legend-name">{s.name}</span>
                <span className="legend-value">{formatPercent(s.share).replace(",0%", "%")}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {sel ? (
        <div className="drill">
          <div className="drill-head">
            <strong>
              {sel.emoji} {sel.name}
            </strong>
            <button type="button" className="link-button small" onClick={() => setSelected(null)}>
              Chiudi
            </button>
          </div>
          <ul className="hbars">
            {detail.map((r) => (
              <li key={r.key} className="hbar">
                <div className="hbar-line">
                  <span>{r.name}</span>
                  <span className="hbar-value">{formatEuros(r.amount)}</span>
                </div>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(r.amount / max) * 100}%`, background: slotColor(sel.slot) }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted small">Tocca una fetta o una voce per vedere le sottocategorie.</p>
      )}
    </div>
  );
}

// --- rispetto al solito ---------------------------------------------------------

export function VersusUsual({ rows, isCurrentMonth, months }: { rows: CategoryRow[]; isCurrentMonth: boolean; months: number }) {
  const [all, setAll] = useState(false);
  if (!months) return <p className="muted">Serve almeno un mese completo di storico per il confronto.</p>;
  // Mese in corso: confronto la stima di fine mese, non lo speso parziale.
  const items = rows
    .map((r) => {
      const value = isCurrentMonth ? (r.forecast ?? r.spent) : r.spent;
      return { ...r, value, delta: value - r.average };
    })
    .filter((r) => r.average > 0 || r.value > 0)
    .filter((r) => Math.abs(r.delta) >= 500) // differenze sotto i 5 € non sono una notizia
    .sort((a, b) => b.delta - a.delta);
  if (!items.length) return <p className="muted">Tutte le categorie sono in linea con la tua media.</p>;
  const shown = all ? items : [...items.filter((i) => i.delta > 0).slice(0, 4), ...items.filter((i) => i.delta < 0).slice(-3)];
  const max = Math.max(...items.map((i) => Math.abs(i.delta)));

  return (
    <div className="card card-padded">
      <p className="muted small">
        {isCurrentMonth ? "Stima di fine mese" : "Speso nel mese"} rispetto alla media degli ultimi {months} {months === 1 ? "mese" : "mesi"}.
      </p>
      <ul className="versus">
        {shown.map((r) => {
          const up = r.delta > 0;
          return (
            <li key={r.id} className="versus-row">
              <span className="versus-name">
                {r.emoji} {r.name}
              </span>
              <div className="versus-bar" aria-hidden>
                <div className="versus-half neg">{!up && <span style={{ width: `${(Math.abs(r.delta) / max) * 100}%` }} />}</div>
                <div className="versus-half pos">{up && <span style={{ width: `${(r.delta / max) * 100}%` }} />}</div>
              </div>
              <span className={`versus-delta ${up ? "delta-bad" : "delta-good"}`}>
                <span aria-hidden>{up ? "▲" : "▼"}</span> {up ? "+" : "−"}
                {formatEuros(Math.abs(r.delta))}
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > shown.length || all ? (
        <button type="button" className="link-button small" onClick={() => setAll(!all)}>
          {all ? "Mostra meno" : `Mostra tutte (${items.length})`}
        </button>
      ) : null}
    </div>
  );
}

// --- piccole spese -----------------------------------------------------------------

export function SmallSpends({ items, total, count }: { items: SmallSpend[]; total: number; count: number }) {
  if (!items.length) return <p className="muted">Nessuna piccola spesa ripetuta questo mese.</p>;
  const yearly = items.reduce((s, i) => s + i.yearly, 0);
  return (
    <div className="card card-padded">
      <div className="small-head">
        <div>
          <strong className="small-total">{formatEuros(total)}</strong>
          <span className="muted small"> in {count} piccole spese (fino a 10 €) questo mese</span>
        </div>
        <span className="small-year">≈ {formatEuros(yearly)} l&apos;anno</span>
      </div>
      <ul className="small-list">
        {items.slice(0, 6).map((i) => (
          <li key={`${i.categoryId}|${i.subcategoryId}`}>
            <span className="cat-emoji" aria-hidden>
              {i.emoji}
            </span>
            <div className="small-main">
              <strong>{i.name}</strong>
              <span className="muted small">
                {i.count} volte · {formatEuros(i.total)} questo mese · media {formatEuros(i.monthlyAverage)}
              </span>
            </div>
            <span className="small-yearly">
              <strong>{formatEuros(i.yearly)}</strong>
              <span className="muted small">l&apos;anno</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">Stima annuale = la media mensile degli ultimi 3 mesi (o questo mese, se più alto) × 12.</p>
    </div>
  );
}

// --- flusso del mese -----------------------------------------------------------------

export function MonthFlow({ d, slots }: { d: Dashboard; slots: Record<string, number> }) {
  const { income, expense, investment } = d.totals;
  if (!income && !expense) return <p className="muted">Nessun movimento in questo mese.</p>;
  const saved = income - expense - investment;
  const sources: FlowNode[] = [{ id: "income", label: "Entrate", value: income, color: "var(--series-income)" }];
  if (saved < 0) sources.push({ id: "savings", label: "Dai risparmi", value: -saved, color: "var(--muted)" });

  const spend = d.categories.filter((c) => c.spent > 0).sort((a, b) => b.spent - a.spent);
  const top = spend.slice(0, 6);
  const rest = spend.slice(6).reduce((s, c) => s + c.spent, 0);
  const targets: FlowNode[] = [
    ...top.map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}`, value: c.spent, color: slotColor(slots[c.id] ?? 0) })),
    ...(rest > 0 ? [{ id: "rest", label: "Altre categorie", value: rest, color: slotColor(0) }] : []),
    ...(investment > 0 ? [{ id: "inv", label: "📈 Investito", value: investment, color: "var(--series-invest)" }] : []),
    ...(saved > 0 ? [{ id: "saved", label: "💰 Risparmiato", value: saved, color: "var(--series-income)" }] : []),
  ];
  return (
    <div className="card card-padded">
      <p className="muted small">
        Da dove arrivano i soldi del mese e dove vanno. {saved >= 0 ? `Ti restano ${formatEuros(saved)}.` : `Hai usato ${formatEuros(-saved)} di risparmi.`}{" "}
        Tocca una voce per evidenziarla.
      </p>
      <Sankey sources={sources} targets={targets} format={formatEuros} />
    </div>
  );
}
