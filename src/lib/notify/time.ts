/** Data e ora a Roma (ora legale compresa), da un istante qualsiasi. Funzione pura. */
export type RomeNow = { date: string; hour: number; minute: number; weekday: number; day: number };

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function romeNow(at: Date = new Date()): RomeNow {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAY[p.weekday], day: Number(p.day) };
}

/** Vero da hh:mm in poi (fino a mezzanotte). */
export const atOrAfter = (t: RomeNow, hour: number, minute = 0) => t.hour * 60 + t.minute >= hour * 60 + minute;

/**
 * Cosa è dovuto a quest'ora. Ogni job ha una chiave giornaliera: se un controllo salta (o fallisce),
 * il successivo lo recupera, ma ciascuno parte una volta sola.
 */
export function dueJobs(t: RomeNow) {
  const jobs: { key: string; kind: "reminder" | "daily" | "weekly" | "monthly" | "backup" }[] = [];
  if (t.day === 1 && atOrAfter(t, 8)) jobs.push({ key: `monthly:${t.date}`, kind: "monthly" });
  if (t.weekday === 1 && atOrAfter(t, 8)) jobs.push({ key: `weekly:${t.date}`, kind: "weekly" });
  if (atOrAfter(t, 21) && !atOrAfter(t, 21, 30)) jobs.push({ key: `reminder:${t.date}`, kind: "reminder" });
  if (atOrAfter(t, 21, 30)) jobs.push({ key: `daily:${t.date}`, kind: "daily" });
  if (t.weekday === 7 && atOrAfter(t, 3)) jobs.push({ key: `backup:${t.date}`, kind: "backup" });
  return jobs;
}

/** Avvisi sul budget solo di giorno. */
export const alertsAllowed = (t: RomeNow) => atOrAfter(t, 8) && !atOrAfter(t, 22);
