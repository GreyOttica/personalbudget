// Formattazione italiana: valuta EUR, fuso Europe/Rome.

export const TIME_ZONE = "Europe/Rome";

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const pct = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const month = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });

export const formatCents = (cents: number) => eur.format(cents / 100);
export const formatPercent = (ratio: number) => pct.format(ratio);

/** "2026-10-01" → "ottobre 2026" (la data è un giorno di calendario, non un istante). */
export const formatMonth = (isoDate: string) => month.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
