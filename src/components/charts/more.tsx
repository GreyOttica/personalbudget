"use client";

// Ciambella, calendario a colori, flusso (Sankey) e mini grafici.
// Stesse regole di charts.tsx: 2px di spazio del colore di sfondo tra le parti,
// identità mai affidata al solo colore (legenda con nome e valore), tocco per i dettagli.
import { useMemo, useState, type ReactNode } from "react";

/** Colore della categoria per slot (1–7, 0 = Altro): vedi --cat-* in globals.css. */
export const slotColor = (slot: number) => `var(--cat-${slot})`;

// --- ciambella --------------------------------------------------------------------

export type DonutSlice = { id: string; label: string; value: number; slot: number };

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0},${y0}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
}

export function Donut({
  slices,
  selected,
  onSelect,
  center,
  size = 200,
}: {
  slices: DonutSlice[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  center: ReactNode;
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const stroke = 26;
  const r = size / 2 - stroke / 2 - 4;
  const c = size / 2;
  // 2px di stacco del colore di sfondo tra le fette (in radianti sul raggio medio).
  const gap = slices.length > 1 ? 2 / r : 0;
  let a = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label="Composizione delle spese per categoria">
        {total > 0 &&
          slices.map((s) => {
            const span = (s.value / total) * Math.PI * 2;
            const a0 = a + gap / 2;
            const a1 = a + span - gap / 2;
            a += span;
            if (a1 <= a0) return null;
            const d = span >= Math.PI * 2 - 0.0001 ? `M${c},${c - r}a${r},${r} 0 1 1 -0.01,0` : arc(c, c, r, a0, a1);
            const dim = selected !== null && selected !== s.id;
            return (
              <path
                key={s.id}
                d={d}
                fill="none"
                stroke={slotColor(s.slot)}
                strokeWidth={selected === s.id ? stroke + 6 : stroke}
                opacity={dim ? 0.35 : 1}
                onClick={() => onSelect(selected === s.id ? null : s.id)}
                style={{ cursor: "pointer", transition: "opacity .2s, stroke-width .2s" }}
              >
                <title>{s.label}</title>
              </path>
            );
          })}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  );
}

// --- calendario a colori --------------------------------------------------------------

const WEEK = ["L", "M", "M", "G", "V", "S", "D"];

/** 5 livelli sequenziali (una sola tinta, dal chiaro allo scuro) per quantili dei giorni con spesa. */
function levels(values: number[]) {
  const pos = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!pos.length) return () => 0;
  const q = [0.2, 0.4, 0.6, 0.8].map((p) => pos[Math.min(pos.length - 1, Math.floor(p * pos.length))]);
  return (v: number) => (v <= 0 ? 0 : 1 + q.filter((t) => v > t).length);
}

export type CalendarDay = { date: string; value: number; count: number; future: boolean };

export function CalendarHeatmap({
  days,
  format,
  renderDetail,
}: {
  days: CalendarDay[];
  format: (v: number) => string;
  renderDetail: (d: CalendarDay) => ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const level = useMemo(() => levels(days.map((d) => d.value)), [days]);
  const lead = days.length ? (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const sel = days.find((d) => d.date === selected) ?? null;

  return (
    <div className="calendar">
      <div className="cal-grid" role="grid" aria-label="Spese per giorno del mese">
        {WEEK.map((w, i) => (
          <span key={i} className="cal-head" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {days.map((d) => {
          const lv = d.future ? -1 : level(d.value);
          return (
            <button
              key={d.date}
              type="button"
              className={`cal-day lv-${lv} ${selected === d.date ? "selected" : ""}`}
              onClick={() => setSelected(selected === d.date ? null : d.date)}
              disabled={d.future}
              aria-label={`${Number(d.date.slice(8))}: ${d.future ? "giorno futuro" : format(d.value)}`}
            >
              {Number(d.date.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="cal-legend" aria-hidden>
        <span>meno</span>
        {[0, 1, 2, 3, 4, 5].map((l) => (
          <span key={l} className={`cal-swatch lv-${l}`} />
        ))}
        <span>più</span>
      </div>
      {sel && <div className="cal-detail">{renderDetail(sel)}</div>}
    </div>
  );
}

// --- flusso (Sankey a due colonne) ------------------------------------------------------

export type FlowNode = { id: string; label: string; value: number; color: string };

/**
 * Sinistra: da dove arrivano i soldi (entrate, eventualmente risparmi usati).
 * Destra: dove vanno (categorie, investimenti, risparmio). Lo spessore è in euro.
 */
export function Sankey({ sources, targets, format }: { sources: FlowNode[]; targets: FlowNode[]; format: (v: number) => string }) {
  const [active, setActive] = useState<string | null>(null);
  const W = 340;
  const nodeW = 10;
  const gap = 6;
  const total = Math.max(
    sources.reduce((s, n) => s + n.value, 0),
    targets.reduce((s, n) => s + n.value, 0),
  );
  // Ogni destinazione occupa almeno LABEL_H in altezza, così le etichette non si
  // sovrappongono; lo spessore del nastro resta proporzionale agli euro.
  const LABEL_H = 18;
  const H = Math.max(220, targets.length * 30);
  const k = Math.min((H - gap * (sources.length - 1)) / (total || 1), (H - gap * (targets.length - 1)) / (total || 1));
  const place = (nodes: FlowNode[], minSlot: number) => {
    let y = 0;
    return nodes.map((n) => {
      const h = Math.max(2, n.value * k);
      const out = { ...n, y, h, slot: Math.max(h, minSlot) };
      y += out.slot + gap;
      return out;
    });
  };
  const left = place(sources, 0);
  const right = place(targets, LABEL_H);
  const height = Math.max(...right.map((n) => n.y + n.slot), ...left.map((n) => n.y + n.slot));
  const xL = 0;
  const xR = W * 0.46;

  // Ogni sorgente si divide tra le destinazioni in proporzione.
  const links: { d: string; color: string; target: string }[] = [];
  const srcOffset = left.map(() => 0);
  const dstOffset = right.map(() => 0);
  right.forEach((t, j) => {
    left.forEach((s, i) => {
      const share = (s.value / (total || 1)) * t.value;
      const h = share * k;
      if (h < 0.3) return;
      const y0 = s.y + srcOffset[i];
      const y1 = t.y + dstOffset[j];
      srcOffset[i] += h;
      dstOffset[j] += h;
      const x0 = xL + nodeW;
      const x1 = xR;
      const mx = (x0 + x1) / 2;
      links.push({
        d: `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}L${x1},${y1 + h}C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h}Z`,
        color: t.color,
        target: t.id,
      });
    });
  });

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" className="sankey" role="img" aria-label="Flusso del mese: da dove arrivano e dove vanno i soldi">
      {links.map((l, i) => (
        <path key={i} d={l.d} fill={l.color} opacity={active === null || active === l.target ? 0.32 : 0.08} />
      ))}
      {left.map((n) => (
        <g key={n.id}>
          <rect x={xL} y={n.y} width={nodeW} height={n.h} rx={2} fill={n.color} />
        </g>
      ))}
      {right.map((n) => (
        <g key={n.id} onClick={() => setActive(active === n.id ? null : n.id)} style={{ cursor: "pointer" }}>
          <rect x={xR} y={n.y} width={nodeW} height={n.h} rx={2} fill={n.color} />
          <text x={xR + nodeW + 6} y={n.y + Math.max(n.h, 12) / 2} dominantBaseline="middle" className="sankey-label">
            <tspan className="sankey-name">{n.label}</tspan>
            <tspan className="sankey-value" dx={5}>
              {format(n.value)}
            </tspan>
          </text>
        </g>
      ))}
    </svg>
  );
}

// --- mini grafico ----------------------------------------------------------------------

export function Sparkline({ values, width = 96, height = 28, color = "var(--series-expense)" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const x = (i: number) => 4 + (i / (values.length - 1)) * (width - 8);
  const y = (v: number) => height - 4 - (v / max) * (height - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join("");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden className="sparkline">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r={4} fill={color} className="dot" />
    </svg>
  );
}
