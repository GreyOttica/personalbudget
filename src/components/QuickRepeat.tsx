"use client";

import { useMemo } from "react";
import type { RepeatCandidate } from "@/lib/analytics/insights";
import { favorites } from "@/lib/entry/suggest";
import { romeDate } from "@/lib/entry/amount";
import type { Reference, TxnDraft } from "@/lib/entry/types";
import { formatCents } from "@/lib/format";
import { useTransactions } from "@/lib/offline/hooks";
import { saveTxn } from "@/lib/offline/sync";

/** Crea oggi una copia di un movimento frequente (funziona anche offline). */
export async function repeatToday(c: Pick<RepeatCandidate, "type" | "category_id" | "subcategory_id" | "amount_cents" | "note">, accountId: string | null, tag: string | null = null) {
  const txn: TxnDraft = {
    id: crypto.randomUUID(),
    occurred_on: romeDate(),
    type: c.type,
    amount_cents: c.amount_cents,
    category_id: c.category_id,
    subcategory_id: c.subcategory_id,
    subcategory_name: null,
    account_id: accountId,
    note: c.note,
    tag,
    updated_at: new Date().toISOString(),
  };
  await saveTxn(txn);
  return txn;
}

/** Le spese abituali (frequenti e recenti, importo tipico), registrabili in un tocco. */
export function QuickRepeat({ reference, onSaved }: { reference: Reference; onSaved: (t: TxnDraft) => void }) {
  const txns = useTransactions();
  // Niente spese fisse (affitto) né importi sopra i 100 €: un tocco solo deve essere innocuo.
  const candidates = useMemo(() => {
    if (!txns) return [];
    const fixed = new Set(reference.categories.filter((c) => c.is_fixed).map((c) => c.id));
    return favorites(txns, romeDate(), fixed, 5);
  }, [txns, reference]);
  if (!candidates.length) return null;
  return (
    <section className="quick">
      <h2 className="group-title">I tuoi abituali</h2>
      <div className="quick-list">
        {candidates.map((c) => {
          const cat = reference.categories.find((x) => x.id === c.category_id);
          const sub = reference.subcategories.find((x) => x.id === c.subcategory_id);
          return (
            <button
              key={c.key}
              type="button"
              className="quick-item"
              onClick={async () => onSaved(await repeatToday(c, reference.accounts[0]?.id ?? null))}
            >
              <span className="quick-emoji" aria-hidden>
                {cat?.emoji ?? "•"}
              </span>
              <span className="quick-main">
                <strong>{sub?.name ?? cat?.name}</strong>
                <span className="muted small">{c.note ?? cat?.name}</span>
              </span>
              <span className="quick-amount">{formatCents(c.amount_cents)}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">Un tocco salva la spesa di oggi con l&apos;importo di solito. Se cambia qualcosa, cercala nel passo Categoria o correggila da Movimenti.</p>
    </section>
  );
}
