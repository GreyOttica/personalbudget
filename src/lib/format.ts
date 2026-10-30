// Formattazione italiana: valuta EUR, fuso Europe/Rome.

export const TIME_ZONE = "Europe/Rome";

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const pct = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const month = new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });

export const formatCents = (cents: number) => eur.format(cents / 100);
export const formatPercent = (ratio: number) => pct.format(ratio);

/** "2026-10-01" → "ottobre 2026" (la data è un giorno di calendario, non un istante). */
export const formatMonth = (isoDate: string) => month.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));

const eurRound = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" });
const intFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const monthShort = new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" });
const monthOnly = new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" });

/** Euro arrotondati, per cifre grandi e riepiloghi: 1.234 €. */
export const formatEuros = (cents: number) => eurRound.format(Math.round(cents / 100));
/** Numero intero senza simbolo, per le tacche degli assi: 2.000. */
export const formatInt = (n: number) => intFmt.format(n);
/** "2026-10" → "ott" */
export const formatMonthShort = (month: string) => monthShort.format(new Date(`${month}-01T00:00:00Z`)).replace(".", "");
/** "2026-10" → "ottobre" */
export const formatMonthName = (month: string) => monthOnly.format(new Date(`${month}-01T00:00:00Z`));
