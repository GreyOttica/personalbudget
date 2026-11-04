import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { requireOwner } from "@/lib/auth";

export const metadata: Metadata = { title: "Altro" };

type Item = { href: string; icon: string; title: string; hint: string; download?: boolean };

/** Tre gruppi: guardare i numeri, gestire i soldi, sistemare l'app. */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Analisi",
    items: [
      { href: "/grafici", icon: "📊", title: "Grafici del mese", hint: "Piccole spese, flusso del mese, andamento degli ultimi 12 mesi" },
      { href: "/analisi", icon: "🧠", title: "Analisi AI", hint: "Serale, settimanale e mensile, con consigli" },
      { href: "/chat", icon: "💬", title: "Chiedi all'assistente", hint: "«Posso permettermi un viaggio da 800 € a dicembre?»" },
      { href: "/anno", icon: "📅", title: "Riepilogo dell'anno", hint: "Totali, mesi migliori e peggiori, confronto con l'anno prima" },
      { href: "/categorie", icon: "📈", title: "Categorie nel tempo", hint: "Ogni categoria negli ultimi 12 mesi, rispetto alla media" },
      { href: "/viaggi", icon: "🏷️", title: "Viaggi ed eventi", hint: "Quanto è costato ogni tag" },
    ],
  },
  {
    title: "Gestione",
    items: [
      { href: "/chiusura", icon: "🗓️", title: "Chiusura del mese", hint: "Saldo con la banca, com'è andata, budget del mese nuovo" },
      { href: "/budget", icon: "🎯", title: "Budget e obiettivo di risparmio", hint: "Tetti di spesa per categoria e quanto mettere da parte al mese" },
      { href: "/ricorrenti", icon: "🔁", title: "Ricorrenti e abbonamenti", hint: "Affitto, investimento, SIM: addebiti automatici" },
      { href: "/obiettivi", icon: "🏁", title: "Obiettivi", hint: "Somme da mettere da parte entro una data" },
      { href: "/saldo", icon: "🏦", title: "Saldo del conto", hint: "Saldo ING mese per mese, correggibile con quello reale" },
    ],
  },
  {
    title: "Impostazioni",
    items: [
      { href: "/impostazioni", icon: "🎨", title: "Tema e colori", hint: "Chiaro, scuro, carta, nero; colore dei pulsanti" },
      { href: "/notifiche", icon: "🔔", title: "Notifiche e backup", hint: "Avvisi sul budget, promemoria, report del lunedì" },
      { href: "/api/export", icon: "⬇️", title: "Esporta CSV", hint: "Tutti i movimenti, apribile con Excel o Numbers", download: true },
      { href: "/import", icon: "📥", title: "Import storico", hint: "Dal Google Sheet esportato in Excel" },
    ],
  },
];

function Row({ item }: { item: Item }) {
  const inner = (
    <>
      <span className="menu-icon" aria-hidden>
        {item.icon}
      </span>
      <span className="menu-main">
        <strong>{item.title}</strong>
        <span className="muted small">{item.hint}</span>
      </span>
      <span className="chevron" aria-hidden>
        ›
      </span>
    </>
  );
  // Il CSV è un file da scaricare, non una pagina: link normale.
  return item.download ? (
    <a href={item.href} className="menu-row" download>
      {inner}
    </a>
  ) : (
    <Link href={item.href} className="menu-row">
      {inner}
    </Link>
  );
}

export default async function MorePage() {
  const email = await requireOwner().catch(() => "");
  return (
    <main className="page">
      <h1>Altro</h1>
      {GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h2 className="group-title">{g.title}</h2>
          <ul className="card menu">
            {g.items.map((item) => (
              <li key={item.href}>
                <Row item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="card card-padded account">
        <span className="muted">{email}</span>
        <SignOutButton />
      </div>
    </main>
  );
}
