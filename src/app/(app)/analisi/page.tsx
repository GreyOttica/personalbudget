import type { Metadata } from "next";
import Link from "next/link";
import { AnalysisCard, KIND_LABEL, periodLabel, type AnalysisRow } from "@/components/AnalysisCard";
import { PageHeader } from "@/components/PageHeader";
import { aiInfo } from "@/lib/ai/client";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { GenerateButtons } from "./GenerateButtons";
import { isMissingObject } from "@/lib/supabase/missing";

export const metadata: Metadata = { title: "Analisi AI" };

const KINDS = ["daily", "weekly", "monthly"] as const;
/** Esecuzioni al mese quando i job automatici (Fase 5) saranno attivi. */
const RUNS_PER_MONTH = { daily: 30, weekly: 4.35, monthly: 1 } as const;
/** Stima prudente prima di avere dati reali, in dollari per esecuzione. */
const DEFAULT_COST = { daily: 0.05, weekly: 0.07, monthly: 0.09 } as const;

const usd = (v: number) => `$${v.toFixed(2).replace(".", ",")}`;

export default async function AnalysisPage() {
  const ai = aiInfo();
  const supabase = await createClient();
  const today = romeDate();
  const monthStart = `${today.slice(0, 7)}-01T00:00:00+01:00`;
  const [list, chat] = await Promise.all([
    supabase
      .from("analyses")
      .select("id, kind, period_start, period_end, headline, content, model, cost_usd, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("chat_messages").select("cost_usd, created_at").eq("role", "assistant").gte("created_at", monthStart),
  ]);

  if (list.error) {
    const missing = isMissingObject(list.error);
    return (
      <main className="page">
        <PageHeader title="Analisi AI" back="/altro" />
        <section className="card card-padded">
          <p>{missing ? "Manca la tabella delle analisi: esegui su Supabase la migrazione 20261101000006_ai.sql (SQL Editor)." : list.error.message}</p>
        </section>
      </main>
    );
  }

  const rows = (list.data ?? []) as AnalysisRow[];
  const latest = KINDS.map((k) => rows.find((r) => r.kind === k)).filter((r): r is AnalysisRow => !!r);
  const shown = new Set(latest.map((r) => r.id));
  const history = rows.filter((r) => !shown.has(r.id));

  // Costi: spesi questo mese (analisi + chat) e stima mensile a regime dal costo medio reale.
  const thisMonth = rows.filter((r) => r.created_at >= monthStart);
  const spentAnalyses = thisMonth.reduce((s, r) => s + Number(r.cost_usd), 0);
  const chatRows = chat.data ?? [];
  const spentChat = chatRows.reduce((s, r) => s + Number(r.cost_usd), 0);
  const avg = (k: (typeof KINDS)[number]) => {
    const xs = rows.filter((r) => r.kind === k && Number(r.cost_usd) > 0 && !r.model.startsWith("gemini"));
    return xs.length ? xs.reduce((s, r) => s + Number(r.cost_usd), 0) / xs.length : DEFAULT_COST[k];
  };
  const estimateAnalyses = KINDS.reduce((s, k) => s + avg(k) * RUNS_PER_MONTH[k], 0);
  const day = Number(today.slice(8, 10));
  const chatEstimate = day >= 7 ? (spentChat / day) * 30 : spentChat;

  return (
    <main className="page">
      <PageHeader title="Analisi AI" back="/altro" />

      {!ai.configured && (
        <section className="card card-padded">
          <p>
            <strong>AI non configurata.</strong> Su Vercel aggiungi la variabile <code>{ai.keyName}</code> (Settings → Environment
            Variables, tipo <em>Sensitive</em>) e rifai il deploy.
          </p>
        </section>
      )}

      <GenerateButtons disabled={!ai.configured} />

      {latest.length === 0 ? (
        <section className="card card-padded">
          <p className="muted">
            Nessuna analisi ancora. Premi <strong>Serale</strong> per la prima: legge i tuoi numeri, li confronta con la media e propone al
            massimo 3 consigli con l&apos;impatto in euro. Dalla Fase 5 partirà da sola alle 21:30.
          </p>
        </section>
      ) : (
        latest.map((a) => <AnalysisCard key={a.id} a={a} />)
      )}

      <h2 className="group-title">Costo AI</h2>
      {ai.free ? (
        <section className="card card-padded cost-card">
          <div className="cost-row">
            <span>Costo</span>
            <strong>Gratis</strong>
          </div>
          <p className="muted small">
            Google Gemini, piano gratuito (modello {ai.model}). Ha un limite di richieste al minuto e al giorno: se lo raggiungi l&apos;app
            prova il modello Lite, altrimenti ti chiede di riprovare più tardi. Sul piano gratuito Google può usare i dati inviati per
            migliorare i suoi servizi: all&apos;AI arrivano solo totali e medie, e in chat i movimenti che servono a rispondere.
          </p>
          <p className="muted small">
            Questo mese: {thisMonth.length} analisi e {chatRows.length}{" "}
            {chatRows.length === 1 ? "risposta" : "risposte"} in chat.
          </p>
        </section>
      ) : (
        <section className="card card-padded cost-card">
          <div className="cost-row">
            <span>Spesi questo mese</span>
            <strong>{usd(spentAnalyses + spentChat)}</strong>
          </div>
          <p className="muted small">
            Analisi {usd(spentAnalyses)} · chat {usd(spentChat)} ({chatRows.length} {chatRows.length === 1 ? "risposta" : "risposte"})
          </p>
          <div className="cost-row">
            <span>Stima mensile a regime</span>
            <strong>≈ {usd(estimateAnalyses + chatEstimate)}</strong>
          </div>
          <p className="muted small">
            30 serali, 4 settimanali e 1 mensile{rows.length ? " al costo medio reale" : " (stima iniziale)"} = {usd(estimateAnalyses)}, più
            la chat al ritmo attuale. Modello {ai.model}. I numeri li calcola l&apos;app: all&apos;AI arrivano solo i totali, così i token
            restano pochi.
          </p>
        </section>
      )}

      {history.length > 0 && (
        <>
          <h2 className="group-title">Precedenti</h2>
          <ul className="card menu">
            {history.map((a) => (
              <li key={a.id}>
                <details className="history-item">
                  <summary className="menu-row">
                    <span className="menu-main">
                      <strong>{a.headline}</strong>
                      <span className="muted small">
                        {KIND_LABEL[a.kind]} · {periodLabel(a)}
                      </span>
                    </span>
                    <span className="chevron" aria-hidden>
                      ›
                    </span>
                  </summary>
                  <AnalysisCard a={a} />
                </details>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted small more-analysis">
        Hai una domanda precisa? <Link href="/chat">Chiedi all&apos;assistente</Link>.
      </p>
    </main>
  );
}
