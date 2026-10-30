import type { Metadata } from "next";
import { NewEntry } from "./NewEntry";

export const metadata: Metadata = { title: "Nuovo movimento" };

// Pagina statica: i dati arrivano dall'archivio locale, così si apre anche offline.
export default function NewEntryPage() {
  return <NewEntry />;
}
