"use client";

import { useEffect, useRef, useState } from "react";
import type { Proposal } from "@/lib/ai/chat";
import { ProposalCard } from "./ProposalCard";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; tools_used?: string[]; cost_usd?: number; error?: boolean; proposal?: Proposal | null };

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

const SUGGESTIONS = [
  "Posso permettermi un viaggio da 800 € a dicembre?",
  "Come sto andando questo mese rispetto al solito?",
  "Dove posso risparmiare di più?",
  "Riorganizzami il budget per risparmiare 150 € al mese",
  "A questo ritmo sforerò qualche budget questo mese?",
];

const TOOL_LABEL: Record<string, string> = {
  riepilogo_mese: "riepilogo del mese",
  andamento: "andamento mensile",
  categoria: "categoria",
  cerca_movimenti: "movimenti",
  proiezione: "proiezione del saldo",
  ricorrenti_e_obiettivi: "ricorrenti e obiettivi",
  piccole_spese: "piccole spese",
  budget_attuali: "budget attuali",
  proponi_budget: "proposta di budget",
};

/** Testo semplice con **grassetto** ed elenchi "- ": niente HTML dall'AI. */
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

export function Chat({ initial, disabled }: { initial: ChatMessage[]; disabled: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // In fondo alla pagina, così la casella di testo non copre l'ultima risposta (né il tasto "Applica").
    if (end.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    setBusy(true);
    setMessages((m) => [...m, { id: nextId("u"), role: "user", content: question }]);
    let reply: ChatMessage;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: question }) });
      const body = (await res.json().catch(() => ({}))) as { answer?: string; error?: string; toolsUsed?: string[]; costUsd?: number; proposal?: Proposal | null };
      reply = res.ok && body.answer
        ? { id: nextId("a"), role: "assistant", content: body.answer, tools_used: body.toolsUsed, cost_usd: body.costUsd, proposal: body.proposal }
        : { id: nextId("e"), role: "assistant", content: body.error ?? `Errore ${res.status}`, error: true };
    } catch {
      reply = { id: nextId("e"), role: "assistant", content: "Serve la connessione a internet per chiedere all'assistente.", error: true };
    }
    setMessages((m) => [...m, reply]);
    setBusy(false);
  }

  async function reset() {
    if (!confirm("Cancellare tutta la conversazione?")) return;
    const res = await fetch("/api/chat", { method: "DELETE" });
    if (res.ok) setMessages([]);
  }

  return (
    <div className="chat">
      {messages.length === 0 && !busy ? (
        <section className="chat-empty">
          <p className="muted">
            Fai una domanda sui tuoi soldi. L&apos;assistente legge i numeri calcolati dall&apos;app (non li inventa) e ti dice se i dati non
            bastano.
          </p>
          <div className="chat-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chat-suggestion" disabled={disabled} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="chat-list" aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`bubble bubble-${m.role}${m.error ? " bubble-error" : ""}`}>
              {m.role === "assistant" && !m.error ? <Rich text={m.content} /> : <p>{m.content}</p>}
              {m.proposal && <ProposalCard p={m.proposal} />}
              {m.role === "assistant" && !m.error && (m.tools_used?.length ?? 0) > 0 && (
                <span className="bubble-meta">
                  Dati: {m.tools_used!.map((t) => TOOL_LABEL[t] ?? t).join(", ")}
                  {m.cost_usd ? ` · $${Number(m.cost_usd).toFixed(3)}` : ""}
                </span>
              )}
            </div>
          ))}
          {busy && (
            <div className="bubble bubble-assistant bubble-typing" aria-label="L'assistente sta scrivendo">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={end} />
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          placeholder="Scrivi una domanda…"
          rows={1}
          maxLength={1000}
          disabled={disabled}
          aria-label="Domanda"
        />
        <button type="submit" className="chat-send" disabled={disabled || busy || !text.trim()} aria-label="Invia">
          ↑
        </button>
      </form>
      {messages.length > 0 && (
        <button type="button" className="link-button small chat-reset" onClick={reset} disabled={busy}>
          Nuova conversazione
        </button>
      )}
    </div>
  );
}
