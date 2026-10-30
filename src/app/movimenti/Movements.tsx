"use client";

import { useMemo, useState } from "react";
import { PageLink } from "@/components/PageLink";
import { SyncBadge } from "@/components/SyncBadge";
import { centsToInput, parseAmount, relativeDay, romeDate } from "@/lib/entry/amount";
import { txnType, type Direction, type Reference, type Txn, type TxnDraft } from "@/lib/entry/types";
import { formatCents } from "@/lib/format";
import { useReference, useTransactions } from "@/lib/offline/hooks";
import { deleteTxn, saveTxn } from "@/lib/offline/sync";

type Row = Txn & { pending: boolean };

export function Movements() {
  const reference = useReference();
  const txns = useTransactions();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);

  const filtered = useMemo(() => {
    if (!txns || !reference) return [];
    const q = query.trim().toLowerCase();
    if (!q) return txns;
    return txns.filter((t) => {
      const c = reference.categories.find((x) => x.id === t.category_id);
      const s = reference.subcategories.find((x) => x.id === t.subcategory_id);
      return [c?.name, s?.name, t.note, t.tag, centsToInput(t.amount_cents)].some((v) => v?.toLowerCase().includes(q));
    });
  }, [txns, reference, query]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const t of filtered) groups.set(t.occurred_on, [...(groups.get(t.occurred_on) ?? []), t]);
    return [...groups];
  }, [filtered]);

  if (editing && reference) {
    return <EditTxn txn={editing} reference={reference} onClose={() => setEditing(null)} />;
  }

  return (
    <main className="page">
      <div className="entry-top">
        <PageLink href="/" className="link-button">
          ‹ Home
        </PageLink>
        <SyncBadge />
      </div>
      <div className="header">
        <h1>Movimenti</h1>
        <PageLink href="/nuovo" className="button button-small">
          + Nuovo
        </PageLink>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per categoria, nota, tag o importo"
        className="search"
      />

      {txns === undefined || reference === undefined ? null : !reference ? (
        <p className="muted stack">Serve una connessione la prima volta per scaricare i movimenti.</p>
      ) : byDay.length === 0 ? (
        <p className="muted stack">{query ? "Nessun movimento trovato." : "Nessun movimento ancora."}</p>
      ) : (
        byDay.map(([day, rows]) => (
          <section key={day}>
            <h2 className="day-title">{relativeDay(day)}</h2>
            <ul className="txn-list card">
              {rows.map((t) => (
                <li key={t.id}>
                  <TxnRow txn={t} reference={reference} onOpen={() => setEditing(t)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {txns && txns.length >= 300 && (
        <p className="muted stack">Qui vedi gli ultimi 300 movimenti. L&apos;elenco completo con i filtri arriva con la dashboard.</p>
      )}
    </main>
  );
}

function TxnRow({ txn, reference, onOpen }: { txn: Row; reference: Reference; onOpen: () => void }) {
  const c = reference.categories.find((x) => x.id === txn.category_id);
  const s = reference.subcategories.find((x) => x.id === txn.subcategory_id);
  const sign = txn.type === "income" ? "+" : "−";
  return (
    <button type="button" className="txn-row" onClick={onOpen}>
      <span className="emoji" aria-hidden>
        {c?.emoji ?? "•"}
      </span>
      <span className="txn-main">
        <span className="txn-title">{s?.name ?? c?.name ?? "Senza categoria"}</span>
        <span className="muted txn-sub">
          {[s ? c?.name : null, txn.note, txn.tag ? `#${txn.tag}` : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className={`txn-amount ${txn.type}`}>
        {sign}
        {formatCents(txn.amount_cents)}
        {txn.pending && (
          <span className="pending-dot" title="In attesa di sincronizzazione" aria-label="In attesa di sincronizzazione">
            ⏳
          </span>
        )}
      </span>
    </button>
  );
}

function EditTxn({ txn, reference, onClose }: { txn: Row; reference: Reference; onClose: () => void }) {
  const [date, setDate] = useState(txn.occurred_on);
  const [categoryId, setCategoryId] = useState(txn.category_id);
  const [subcategoryId, setSubcategoryId] = useState<string>(txn.subcategory_id ?? "");
  const [newSub, setNewSub] = useState("");
  const [amount, setAmount] = useState(centsToInput(txn.amount_cents));
  const [note, setNote] = useState(txn.note ?? "");
  const [accountId, setAccountId] = useState(txn.account_id ?? reference.accounts[0]?.id ?? "");
  const [direction, setDirection] = useState<Direction>(txn.type === "income" ? "to" : "from");
  const [tag, setTag] = useState(txn.tag ?? "");
  const [busy, setBusy] = useState(false);

  const category = reference.categories.find((c) => c.id === categoryId);
  const subs = reference.subcategories.filter((s) => s.category_id === categoryId);
  const cents = parseAmount(amount);
  const newSubName = newSub.trim();
  const canSave = !!category && cents !== null && !!date && (subcategoryId !== "__new" || !!newSubName);

  async function save() {
    if (!canSave || !category || cents === null) return;
    setBusy(true);
    let subId: string | null = subcategoryId || null;
    let subName: string | null = null;
    if (subcategoryId === "__new") {
      const existing = subs.find((s) => s.name.toLowerCase() === newSubName.toLowerCase());
      subId = existing?.id ?? crypto.randomUUID();
      subName = existing ? null : newSubName;
    }
    const draft: TxnDraft = {
      id: txn.id,
      occurred_on: date,
      type: txnType(direction, category),
      amount_cents: cents,
      category_id: category.id,
      subcategory_id: subId,
      subcategory_name: subName,
      account_id: accountId || null,
      note: note.trim() || null,
      tag: tag.trim() || null,
      updated_at: new Date().toISOString(),
    };
    await saveTxn(draft);
    onClose();
  }

  async function remove() {
    if (!window.confirm("Eliminare questo movimento?")) return;
    setBusy(true);
    await deleteTxn(txn.id);
    onClose();
  }

  return (
    <main className="page">
      <div className="entry-top">
        <button type="button" className="link-button" onClick={onClose}>
          ‹ Movimenti
        </button>
        <SyncBadge />
      </div>
      <h1>Modifica movimento</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Data</span>
          <input type="date" value={date} max={romeDate()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>Categoria</span>
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setSubcategoryId("");
            }}
          >
            {reference.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sottocategoria</span>
          <select value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
            <option value="">Nessuna</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">+ Nuova sottocategoria…</option>
          </select>
        </label>
        {subcategoryId === "__new" && (
          <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Nome della sottocategoria" maxLength={60} autoFocus />
        )}
        <label className="field">
          <span>Importo (€)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-invalid={cents === null} />
        </label>
        <label className="field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <div className="field">
          <span>Conto</span>
          <div className="button-row">
            {(["from", "to"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`button ${direction === d ? "" : "button-secondary"}`}
                onClick={() => setDirection(d)}
                aria-pressed={direction === d}
              >
                {d === "from" ? "Da" : "A"} {reference.accounts.find((a) => a.id === accountId)?.name ?? "conto"}
              </button>
            ))}
          </div>
          {reference.accounts.length > 1 && (
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {reference.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <label className="field">
          <span>Tag</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} list="tag-list" maxLength={60} placeholder="Nessun tag" />
          <datalist id="tag-list">
            {reference.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <button type="submit" className="button button-big" disabled={!canSave || busy}>
          Salva modifiche
        </button>
        <button type="button" className="button button-danger" onClick={() => void remove()} disabled={busy}>
          Elimina movimento
        </button>
      </form>
    </main>
  );
}
