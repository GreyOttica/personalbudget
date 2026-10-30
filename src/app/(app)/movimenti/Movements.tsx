"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { SyncBadge } from "@/components/SyncBadge";
import { centsToInput, parseAmount, relativeDay, romeDate } from "@/lib/entry/amount";
import { txnType, type Direction, type Reference, type Txn, type TxnDraft } from "@/lib/entry/types";
import { formatCents, formatEuros, formatMonth } from "@/lib/format";
import { useReference, useTransactions } from "@/lib/offline/hooks";
import { deleteTxn, saveTxn } from "@/lib/offline/sync";

type Row = Txn & { pending: boolean };

type TypeFilter = "all" | "expense" | "income" | "investment";
const TYPE_LABELS: Record<TypeFilter, string> = { all: "Tutti", expense: "Uscite", income: "Entrate", investment: "Investimenti" };
const PAGE = 60;

export function Movements() {
  const reference = useReference();
  const txns = useTransactions();
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  // Dal grafico "Per giorno" della Home si arriva con ?giorno=YYYY-MM-DD.
  const router = useRouter();
  const giorno = useSearchParams().get("giorno") ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(giorno) ? giorno : "";
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<Row | null>(null);

  const months = useMemo(() => [...new Set((txns ?? []).map((t) => t.occurred_on.slice(0, 7)))].sort().reverse(), [txns]);

  const filtered = useMemo(() => {
    if (!txns || !reference) return [];
    const q = query.trim().toLowerCase();
    return txns.filter((t) => {
      if (day && t.occurred_on !== day) return false;
      if (month && !t.occurred_on.startsWith(month)) return false;
      if (type !== "all" && t.type !== type) return false;
      if (categoryId && t.category_id !== categoryId) return false;
      if (tag && t.tag !== tag) return false;
      if (!q) return true;
      const c = reference.categories.find((x) => x.id === t.category_id);
      const s = reference.subcategories.find((x) => x.id === t.subcategory_id);
      return [c?.name, s?.name, t.note, t.tag, centsToInput(t.amount_cents)].some((v) => v?.toLowerCase().includes(q));
    });
  }, [txns, reference, query, month, type, categoryId, tag, day]);

  const totals = useMemo(() => {
    const out = { expense: 0, income: 0, investment: 0 };
    for (const t of filtered) out[t.type] += t.amount_cents;
    return out;
  }, [filtered]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const t of filtered.slice(0, limit)) groups.set(t.occurred_on, [...(groups.get(t.occurred_on) ?? []), t]);
    return [...groups];
  }, [filtered, limit]);

  const anyFilter = !!(query || month || type !== "all" || categoryId || tag || day);
  const reset = () => {
    setQuery("");
    setMonth("");
    setType("all");
    setCategoryId("");
    setTag("");
    if (day) router.replace("/movimenti");
  };

  if (editing && reference) {
    return <EditTxn txn={editing} reference={reference} onClose={() => setEditing(null)} />;
  }

  return (
    <main className="page">
      <div className="header">
        <h1>Movimenti</h1>
        <SyncBadge />
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca per categoria, nota, tag o importo"
        className="search"
      />
      {day && (
        <div className="chip-list">
          <button type="button" className="chip chip-sm selected" onClick={reset} aria-label="Togli il filtro per giorno">
            {relativeDay(day)} ✕
          </button>
        </div>
      )}
      <div className="segmented" role="group" aria-label="Tipo di movimento">
        {(Object.keys(TYPE_LABELS) as TypeFilter[]).map((k) => (
          <button key={k} type="button" className={type === k ? "selected" : ""} aria-pressed={type === k} onClick={() => setType(k)}>
            {TYPE_LABELS[k]}
          </button>
        ))}
      </div>
      {reference && (
        <div className="filters">
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mese">
            <option value="">Tutti i mesi</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(`${m}-01`)}
              </option>
            ))}
          </select>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoria">
            <option value="">Tutte le categorie</option>
            {reference.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
          {reference.tags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">Tutti i tag</option>
              {reference.tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {txns && reference && (
        <div className="filter-summary">
          <span className="muted small">
            {filtered.length} {filtered.length === 1 ? "movimento" : "movimenti"}
          </span>
          <span className="small">
            {totals.expense > 0 && <span>Uscite {formatEuros(totals.expense)}</span>}
            {totals.income > 0 && <span>Entrate {formatEuros(totals.income)}</span>}
            {totals.investment > 0 && <span>Investiti {formatEuros(totals.investment)}</span>}
          </span>
          {anyFilter && (
            <button type="button" className="link-button small" onClick={reset}>
              Azzera filtri
            </button>
          )}
        </div>
      )}

      {txns === undefined || reference === undefined ? null : !reference ? (
        <p className="muted stack">Serve una connessione la prima volta per scaricare i movimenti.</p>
      ) : byDay.length === 0 ? (
        <p className="muted stack">{anyFilter ? "Nessun movimento con questi filtri." : "Nessun movimento ancora."}</p>
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
      {filtered.length > limit && (
        <button type="button" className="button button-secondary load-more" onClick={() => setLimit(limit + PAGE * 2)}>
          Mostra altri ({filtered.length - limit})
        </button>
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
