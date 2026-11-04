// Notifiche positive: "stai andando bene", serie di giorni sotto la quota. Funzione pura, testata.
import { addDays, weekdayOf } from "../analytics/dashboard.ts";
import type { Prediction } from "../analytics/predict.ts";
import { formatEuros } from "../format.ts";

/** Soglie per dire "stai andando bene": niente complimenti se non sono probabili. */
const GOOD_MIN_DAY = 8;
const GOOD_MIN_PROBABILITY = 0.75;
const GOOD_MIN_EXTRA = 3000; // almeno 30 € più del solito
const STREAKS = [5, 10, 15, 20, 25];

/** `lastEntry`: data dell'ultimo movimento registrato a mano. Se non registri da 2 giorni, niente complimenti:
 * giorni "vuoti" potrebbero essere solo spese non ancora inserite. */
export function positiveMessage(p: Prediction | null, date: string, day: number, lastEntry: string | null = date) {
  if (!p || !lastEntry || lastEntry < addDays(date, -2)) return null;
  const q = p.quota;
  if (q && STREAKS.includes(q.streak)) {
    return {
      key: `streak:${p.month}:${q.streak}`,
      title: `🔥 ${q.streak} giorni di fila sotto la quota`,
      body: `${q.vsPace > 0 ? `Sei ${formatEuros(q.vsPace)} sotto il ritmo previsto. ` : ""}Quota di oggi: ${formatEuros(q.today)}. Continua così.`,
    };
  }
  if (
    day >= GOOD_MIN_DAY &&
    p.usualSavings !== null &&
    p.probAboveUsual !== null &&
    p.probAboveUsual >= GOOD_MIN_PROBABILITY &&
    p.savings.p50 - p.usualSavings >= GOOD_MIN_EXTRA
  ) {
    const week = addDays(date, -weekdayOf(date)); // una volta a settimana
    return {
      key: `good:${week}`,
      title: "👏 Stai andando bene",
      body: `A questo ritmo a fine mese risparmi circa ${formatEuros(p.savings.p50)}, ${formatEuros(p.savings.p50 - p.usualSavings)} più del solito (${Math.round(p.probAboveUsual * 100)}% di probabilità).`,
    };
  }
  return null;
}
