import type { Metadata } from "next";
import Link from "next/link";
import { AppearanceSettings } from "./AppearanceSettings";

export const metadata: Metadata = { title: "Impostazioni" };

export default function SettingsPage() {
  return (
    <main className="page">
      <Link href="/altro" className="back-link">
        ‹ Altro
      </Link>
      <h1>Impostazioni</h1>
      <AppearanceSettings />
      <h2 className="group-title">Notifiche</h2>
      <div className="card card-padded">
        <p className="muted">
          Analisi serale, report, promemoria e avvisi sul budget si attiveranno qui una per una con la Fase 5.
        </p>
      </div>
    </main>
  );
}
