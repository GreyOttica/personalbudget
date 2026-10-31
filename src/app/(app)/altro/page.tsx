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
              <span className="muted small">Tema e colori</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/notifiche" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🔔
            </span>
            <span className="menu-main">
              <strong>Notifiche e backup</strong>
              <span className="muted small">Avvisi sul budget, promemoria, report del lunedì</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
      </ul>

      <h2 className="group-title">Assistente AI</h2>
      <ul className="card menu">
        <li>
          <Link href="/analisi" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🧠
            </span>
            <span className="menu-main">
              <strong>Analisi</strong>
              <span className="muted small">Serale, settimanale e mensile, con consigli e costo</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/chat" className="menu-row">
            <span className="menu-icon" aria-hidden>
              💬
            </span>
            <span className="menu-main">
              <strong>Chiedi all&apos;assistente</strong>
              <span className="muted small">«Posso permettermi un viaggio da 800 € a dicembre?»</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
      </ul>

      <h2 className="group-title">Analisi</h2>
      <ul className="card menu">
        <li>
          <Link href="/anno" className="menu-row">
            <span className="menu-icon" aria-hidden>
              📅
            </span>
            <span className="menu-main">
              <strong>Riepilogo dell&apos;anno</strong>
              <span className="muted small">Totali, mesi migliori e peggiori, confronto con l&apos;anno prima</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/saldo" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🏦
            </span>
            <span className="menu-main">
              <strong>Saldo del conto</strong>
              <span className="muted small">Come cambia il saldo ING mese per mese</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/categorie" className="menu-row">
            <span className="menu-icon" aria-hidden>
              📊
            </span>
            <span className="menu-main">
              <strong>Categorie nel tempo</strong>
              <span className="muted small">Andamento di ogni categoria negli ultimi 12 mesi</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/ricorrenti" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🔁
            </span>
            <span className="menu-main">
              <strong>Ricorrenti e abbonamenti</strong>
              <span className="muted small">Addebiti mensili riconosciuti in automatico</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/viaggi" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🏷️
            </span>
            <span className="menu-main">
              <strong>Viaggi ed eventi</strong>
              <span className="muted small">Quanto è costato ogni tag</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </Link>
        </li>
        <li>
          <Link href="/obiettivi" className="menu-row">
            <span className="menu-icon" aria-hidden>
              🎯
            </span>
            <span className="menu-main">
              <strong>Obiettivi di risparmio</strong>
              <span className="muted small">Quanto mettere da parte al mese</span>
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

      <h2 className="group-title">Account</h2>
      <div className="card card-padded account">
        <span className="muted">{email}</span>
        <SignOutButton />
      </div>
    </main>
  );
}
