import type { Metadata } from "next";
import { Movements } from "./Movements";

export const metadata: Metadata = { title: "Movimenti" };

// Pagina statica: i movimenti arrivano dall'archivio locale, così si apre anche offline.
export default function MovementsPage() {
  return <Movements />;
}
