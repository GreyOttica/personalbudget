"use client";

// Grafici SVG senza librerie, secondo le regole della guida dataviz:
// barre ≤ 24px con estremità arrotondate di 4px e base squadrata, linee da 2px,
// punti ≥ 8px con anello del colore di sfondo, griglia sottile e silenziosa,
// legenda per 2+ serie, tooltip al passaggio o al tocco, tabella dei dati.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type Series = { key: string; name: string; color: string };
/** label: etichetta breve sull'asse; title: nome completo in tooltip e tabella. */
export type Point = { key: string; label: string; title: string; values: Record<string, number | null> };

const AXIS_W = 44;
const PAD_TOP = 12;
const AXIS_H = 22;

/** Chiude il tooltip toccando fuori dal grafico (su iPhone non c'è "mouse leave"). */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [ref, onDismiss]);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Tacche "pulite" (1, 2, 2,5, 5 × 10^n) che coprono [min, max] includendo lo zero. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Rettangolo con angoli arrotondati solo all'estremità dei dati (in alto se positivo). */
function barPath(x: number, y0: number, y1: number, w: number, r = 4) {
  const top = Math.min(y0, y1);
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const rr = Math.min(r, h, w / 2);
  if (y1 <= y0) {
    return `M${x},${y0}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${y0}Z`;
  }
  const bottom = top + h;
  return `M${x},${y0}V${bottom - rr}Q${x},${bottom} ${x + rr},${bottom}H${x + w - rr}Q${x + w},${bottom} ${x + w},${bottom - rr}V${y0}Z`;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.key}>
          <span className="swatch" style={{ background: s.color }} aria-hidden />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

type ChartProps = {
  points: Point[];
  series: Series[];
  formatTick: (v: number) => string;
  formatValue: (v: number) => string;
  /** contenuto extra del tooltip (per esempio un link al mese) */
  tooltipExtra?: (p: Point) => ReactNode;
  selectedKey?: string;
  height?: number;
  ariaLabel: string;
  tableCaption: string;
  /** intestazione della prima colonna della tabella dei dati */
  tableFirstColumn?: string;
};

/** Colonne raggruppate: una colonna per serie in ogni gruppo. */
export function ColumnChart(props: ChartProps) {
  const { points, series, formatTick, height = 200 } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  useDismiss(ref, useCallback(() => setActive(null), []));

  const all = points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0));
  const ticks = niceTicks(Math.min(...all, 0), Math.max(...all, 0));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - AXIS_W);
  const plotH = height - PAD_TOP - AXIS_H;
  const y = (v: number) => PAD_TOP + ((hi - v) / (hi - lo || 1)) * plotH;
  const band = points.length ? plotW / points.length : 0;
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);

  return (
    <figure className="chart" ref={ref} onMouseLeave={() => setActive(null)}>
      <Legend series={series} />
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={props.ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-zero" : "grid"} />
              <text x={AXIS_W - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const x0 = AXIS_W + i * band + (band - groupW) / 2;
            const dim = active !== null && active !== i;
            return (
              <g key={p.key} opacity={dim ? 0.45 : 1}>
                {p.key === props.selectedKey && (
                  <rect x={AXIS_W + i * band + 1} y={PAD_TOP} width={band - 2} height={plotH} rx={6} className="band-selected" />
                )}
                {series.map((s, j) => (
                  <path key={s.key} d={barPath(x0 + j * (barW + gap), y(0), y(p.values[s.key] ?? 0), barW)} fill={s.color} />
                ))}
                {p.label && (
                  <text x={AXIS_W + i * band + band / 2} y={height - 6} className="tick" textAnchor="middle">
                    {p.label}
                  </text>
                )}
                {/* area di tocco più grande delle barre */}
                <rect
                  x={AXIS_W + i * band}
                  y={0}
                  width={band}
                  height={height}
                  fill="transparent"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => setActive(i)}
                  style={{ cursor: "pointer" }}
                />
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && points[active] && (
        <Tooltip {...props} point={points[active]} left={AXIS_W + active * band + band / 2} width={width} />
      )}
      <DataTable {...props} />
    </figure>
  );
}

/**
 * Linee, una per serie. Con pochi punti (mesi) ogni valore ha il suo punto; con
 * tanti punti (giorni) solo l'ultimo valore della serie, per non affollare.
 */
export function LineChart(props: ChartProps) {
  const { points, series, formatTick, height = 170 } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  useDismiss(ref, useCallback(() => setActive(null), []));

  const vals = points.flatMap((p) => series.map((s) => p.values[s.key])).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.min(...vals, 0), Math.max(...vals, 0));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - AXIS_W);
  const plotH = height - PAD_TOP - AXIS_H;
  const band = points.length ? plotW / points.length : 0;
  const x = (i: number) => AXIS_W + i * band + band / 2;
  const y = (v: number) => PAD_TOP + ((hi - v) / (hi - lo || 1)) * plotH;
  const everyDot = points.length <= 14;

  // Segmenti continui per serie: un valore mancante interrompe la linea.
  const lines = series.map((s) => {
    const segments: string[] = [];
    let cur = "";
    let last: number | null = null;
    points.forEach((p, i) => {
      const v = p.values[s.key];
      if (v === null) {
        if (cur) segments.push(cur);
        cur = "";
      } else {
        cur += `${cur ? "L" : "M"}${x(i)},${y(v)}`;
        last = i;
      }
    });
    if (cur) segments.push(cur);
    return { s, segments, last };
  });

  return (
    <figure className="chart" ref={ref} onMouseLeave={() => setActive(null)}>
      <Legend series={series} />
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={props.ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} className={t === 0 ? "axis-zero" : "grid"} />
              <text x={AXIS_W - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD_TOP} y2={PAD_TOP + plotH} className="crosshair" />}
          {lines.map(({ s, segments }) =>
            segments.map((d, i) => (
              <path key={`${s.key}-${i}`} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )),
          )}
          {lines.map(({ s, last }) =>
            points.map((p, i) => {
              const v = p.values[s.key];
              const show = v !== null && (everyDot || i === last || i === active);
              if (!show) return null;
              const big = active === i || p.key === props.selectedKey;
              return <circle key={`${s.key}-${p.key}`} cx={x(i)} cy={y(v!)} r={big ? 5 : 4} fill={s.color} className="dot" />;
            }),
          )}
          {points.map((p, i) => (
            <g key={p.key}>
              {p.label && (
                <text x={x(i)} y={height - 6} className="tick" textAnchor="middle">
                  {p.label}
                </text>
              )}
              <rect
                x={AXIS_W + i * band}
                y={0}
                width={band}
                height={height}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}
                style={{ cursor: "pointer" }}
              />
            </g>
          ))}
        </svg>
      )}
      {active !== null && points[active] && <Tooltip {...props} point={points[active]} left={x(active)} width={width} />}
      <DataTable {...props} />
    </figure>
  );
}

function Tooltip({
  point,
  series,
  formatValue,
  tooltipExtra,
  left,
  width,
}: ChartProps & { point: Point; left: number; width: number }) {
  const W = 180;
  const clamped = Math.max(0, Math.min(width - W, left - W / 2));
  return (
    <div className="chart-tooltip" style={{ left: clamped, width: W }} role="status">
      <strong>{point.title}</strong>
      {series.map((s) => (
        <div key={s.key} className="tooltip-row">
          <span className="swatch" style={{ background: s.color }} aria-hidden />
          <span>{s.name}</span>
          <span className="tooltip-value">{point.values[s.key] === null ? "—" : formatValue(point.values[s.key]!)}</span>
        </div>
      ))}
      {tooltipExtra?.(point)}
    </div>
  );
}

function DataTable({ points, series, formatValue, tableCaption, tableFirstColumn = "Mese" }: ChartProps) {
  return (
    <details className="chart-table">
      <summary>Mostra i dati in tabella</summary>
      <table>
        <caption className="sr-only">{tableCaption}</caption>
        <thead>
          <tr>
            <th>{tableFirstColumn}</th>
            {series.map((s) => (
              <th key={s.key}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <td>{p.title}</td>
              {series.map((s) => (
                <td key={s.key}>{p.values[s.key] === null ? "—" : formatValue(p.values[s.key]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
