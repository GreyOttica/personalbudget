"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { centsToInput, parseAmount } from "@/lib/entry/amount";
import { deleteTagBudget, saveTagBudget } from "./actions";

/** Modulo per il budget di un viaggio o evento. Con `fixedTag` il nome non si cambia (pagina del tag). */
export function TagBudgetEditor({
  fixedTag,
  tags = [],
  initial,
  onDone,
}: {
  fixedTag?: string;
  tags?: string[];
  initial?: { amount_cents: number; ends_on: string | null } | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [tag, setTag] = useState(fixedTag ?? "");
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amount_cents).replace(/,00$/, "") : "");
  const [endsOn, setEndsOn] = useState(initial?.ends_on ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseAmount(amount);

  async function save() {
    if (cents === null) return setError("Scrivi un importo valido, per esempio 1.500.");
    setBusy(true);
    const r = await saveTagBudget(tag, cents, endsOn || null);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    onDone?.();
    router.refresh();
  }

  async function remove() {
    if (!fixedTag || !window.confirm(`Togliere il budget di "${fixedTag}"? Le spese restano.`)) return;
    setBusy(true);
    const r = await deleteTagBudget(fixedTag);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone?.();
    router.refresh();
  }

  return (
    <div className="tag-budget-form">
      {!fixedTag && (
        <label className="field">
          <span>Viaggio o evento (tag)</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} list="tag-list" placeholder="Giappone 2026" autoCapitalize="words" />
          <datalist id="tag-list">
            {tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
      )}
      <div className="tag-budget-row">
        <label className="field">
          <span>Budget</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.500" aria-label="Budget in euro" />
        </label>
        <label className="field">
          <span>Fino al (facoltativo)</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </label>
      </div>
      {error && <p className="check-diff small">{error}</p>}
      <div className="button-row">
        <button type="button" className="button" disabled={busy || !tag.trim() || cents === null} onClick={save}>
          Salva budget
        </button>
        {fixedTag && initial ? (
          <button type="button" className="button button-danger" disabled={busy} onClick={remove}>
            Togli
          </button>
        ) : onDone ? (
          <button type="button" className="button button-secondary" onClick={onDone}>
            Annulla
          </button>
        ) : null}
      </div>
      <p className="muted small">Le spese contano se hanno questo tag (ultimo passo del nuovo movimento). Con la data di fine vedi quanto puoi spendere al giorno.</p>
    </div>
  );
}

/** Pulsante "+ Budget per un viaggio" che apre il modulo. */
export function NewTagBudget({ tags }: { tags: string[] }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <section className="card card-padded">
      <TagBudgetEditor tags={tags} onDone={() => setOpen(false)} />
    </section>
  ) : (
    <button type="button" className="button button-secondary tag-budget-new" onClick={() => setOpen(true)}>
      + Budget per un viaggio o evento
    </button>
  );
}

/** Sulla pagina del tag: mostra il modulo per creare o modificare il budget. */
export function EditTagBudget({ tag, initial }: { tag: string; initial: { amount_cents: number; ends_on: string | null } | null }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="link-button small" onClick={() => setOpen(true)}>
        {initial ? "Modifica il budget" : "+ Imposta un budget per questo viaggio"}
      </button>
    );
  return (
    <section className="card card-padded">
      <TagBudgetEditor fixedTag={tag} initial={initial} onDone={() => setOpen(false)} />
    </section>
  );
}
