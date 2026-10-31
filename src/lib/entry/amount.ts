// Importi e date in formato italiano.

import { TIME_ZONE } from "@/lib/format";

const MAX_CENTS = 10_000_000_00; // 10 milioni di euro: oltre è sicuramente un errore di battitura

/**
 * "2,80" / "2.80" / "1.234,56" / "1234" → centesimi. null se non è un importo valido e positivo.
 * Con la virgola, i punti sono separatori delle migliaia; senza virgola, un solo punto è il decimale.
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[\s€]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** Centesimi → testo modificabile, per esempio 280 → "2,80". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Oggi (o oggi meno n giorni) come YYYY-MM-DD nel fuso di Roma. */
export function romeDate(daysAgo = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  if (!daysAgo) return today;
  // Giorni di calendario, non 24 ore: col cambio dell'ora "ieri" resta ieri.
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const dayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayFmtYear = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-31" → "venerdì 31 ottobre" (con l'anno se non è quello corrente). */
export function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const sameYear = isoDate.slice(0, 4) === romeDate().slice(0, 4);
  return (sameYear ? dayFmt : dayFmtYear).format(d);
}

/** Oggi / Ieri / data estesa. */
export function relativeDay(isoDate: string): string {
  if (isoDate === romeDate()) return "Oggi";
  if (isoDate === romeDate(1)) return "Ieri";
  return formatDay(isoDate);
}
