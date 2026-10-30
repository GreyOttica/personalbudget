import type { Metadata } from "next";
import Link from "next/link";
import { ImportForm } from "./ImportForm";

export const metadata: Metadata = { title: "Import storico" };

export default function ImportPage() {
  return (
    <main className="page">
      <Link href="/" className="back-link">
        ‹ Home
      </Link>
      <h1>Import storico</h1>
      <p className="muted">
        Carica l&apos;export del Google Sheet (File → Scarica → Microsoft Excel). Puoi ripetere l&apos;import quante volte
        vuoi: aggiunge solo le righe nuove e aggiorna quelle modificate nel foglio.
      </p>
      <ImportForm />
    </main>
  );
}
