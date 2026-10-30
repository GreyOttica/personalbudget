import type { Metadata } from "next";
import { Suspense } from "react";
import { Movements } from "./Movements";

export const metadata: Metadata = { title: "Movimenti" };

// Pagina statica: i movimenti arrivano dall'archivio locale, così si apre anche offline.
export default function MovementsPage() {
  // Suspense: l'elenco legge i parametri dell'URL (?giorno=) solo nel browser.
  return (
    <Suspense>
      <Movements />
    </Suspense>
  );
}
