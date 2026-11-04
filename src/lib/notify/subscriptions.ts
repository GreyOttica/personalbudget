// Avvisi sugli abbonamenti: aumento di prezzo e abbonamento nuovo riconosciuto. Funzione pura, testata.
import type { Recurring } from "../analytics/insights.ts";
import { addDays } from "../analytics/dashboard.ts";
import { formatCents, formatEuros } from "../format.ts";

const MAX_INCREASE = 0.35;

export type SubEvent = { key: string; kind: "sub_up" | "sub_new"; title: string; body: string };

/** `seen`: chiavi degli abbonamenti già conosciuti (null = primo controllo: si registrano senza avvisare). */
export function subscriptionEvents(detected: Recurring[], today: string, seen: Set<string> | null): { events: SubEvent[]; seenKeys: string[] } {
  const events: SubEvent[] = [];
  const seenKeys: string[] = [];
  for (const d of detected) {
    const id = `${d.categoryId}|${d.subcategoryId ?? ""}`;
    seenKeys.push(`sub_seen:${id}`);
    // Aumento recente (ultimo addebito negli ultimi 35 giorni), una volta per nuovo importo. Solo aumenti
    // moderati (fino al 35%): quelli tipici degli abbonamenti, non un taglio di capelli più caro del solito.
    const up = d.changed && d.previous !== null && d.last > d.previous && d.last - d.previous <= d.previous * MAX_INCREASE;
    if (up && d.previous !== null && d.lastDate >= addDays(today, -35)) {
      events.push({
        key: `sub_up:${id}:${d.last}`,
        kind: "sub_up",
        title: `🔁 ${d.name} è aumentato`,
        body: `Da ${formatCents(d.previous)} a ${formatCents(d.last)}: ${formatEuros((d.last - d.previous) * 12)} in più l'anno. Lo usi ancora?`,
      });
    }
    if (seen && !seen.has(`sub_seen:${id}`)) {
      events.push({
        key: `sub_new:${id}`,
        kind: "sub_new",
        title: `🔁 Nuova spesa ricorrente: ${d.name}`,
        body: `Circa ${formatCents(d.typical)} al mese (${formatEuros(d.yearly)} l'anno). In Ricorrenti puoi renderla automatica.`,
      });
    }
  }
  return { events, seenKeys };
}
