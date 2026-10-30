import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { requireOwner } from "@/lib/auth";

export const metadata: Metadata = { title: "Altro" };

export default async function MorePage() {
  const email = await requireOwner().catch(() => "");
  return (
    <main className="page">
      <h1>Altro</h1>

      <h2 className="group-title">Preferenze</h2>
      <ul className="card menu">
        <li>
          <Link href="/impostazioni" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🎨
            </span>
            <span className="menu-main">
              <strong>Impostazioni</strong>
              <span className="muted small">Tema, colori e, presto, notifiche</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
      </ul>

      <h2 className="group-title">Dati</h2>
      <ul className="card menu">
        <li>
          <a href="/api/export" className="menu-row" download>
            <span className="menu-icon" aria-hidden>
              ⬇️
            </span>
            <span className="menu-main">
              <strong>Esporta CSV</strong>
              <span className="muted small">Tutti i movimenti, apribile con Excel o Numbers</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </a>
        </li>
        <li>
          <Link href="/import" className="menu-row">
            <span className="menu-icon" aria-hidden>
              📥
            </span>
            <span className="menu-main">
              <strong>Import storico</strong>
              <span className="muted small">Dal Google Sheet esportato in Excel</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/budget" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🎯
            </span>
            <span className="menu-main">
              <strong>Budget mensili</strong>
              <span className="muted small">Tetti di spesa per categoria</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
      </ul>

      <h2 className="group-title">In arrivo</h2>
      <ul className="card menu">
        <li className="menu-row disabled">
          <span className="menu-icon" aria-hidden>
            🤖
          </span>
          <span className="menu-main">
            <strong>Analisi AI e chat</strong>
            <span className="muted small">Fase 4</span>
          </span>
        </li>
        <li className="menu-row disabled">
          <span className="menu-icon" aria-hidden>
            🔔
          </span>
          <span className="menu-main">
            <strong>Notifiche</strong>
            <span className="muted small">Fase 5</span>
          </span>
        </li>
      </ul>

      <h2 className="group-title">Account</h2>
      <div className="card card-padded account">
        <span className="muted">{email}</span>
        <SignOutButton />
      </div>
    </main>
  );
}
