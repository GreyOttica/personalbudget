"use client";

import { PageLink } from "@/components/PageLink";
import { useMemo, useRef, useState } from "react";
import { SyncBadge } from "@/components/SyncBadge";
import { formatDay, parseAmount, relativeDay, romeDate } from "@/lib/entry/amount";
import { defaultDirection, txnType, type Category, type Direction, type Reference, type TxnDraft } from "@/lib/entry/types";
import { formatCents } from "@/lib/format";
import { QuickRepeat } from "@/components/QuickRepeat";
import { useReference, useSyncState } from "@/lib/offline/hooks";
import { flush, saveTxn } from "@/lib/offline/sync";

// Stesso ordine del Google Form: data, categoria, sottocategoria, importo, note, conto (Da/A), tag.
const STEPS = ["date", "category", "subcategory", "amount", "note", "account", "tag"] as const;
type Step = (typeof STEPS)[number];

type Draft = {
  date: string;
  categoryId: string | null;
  subcategory: { id: string; name: string; isNew: boolean } | null;
  amountText: string;
  note: string;
  accountId: string | null;
  direction: Direction;
  tag: string;
};

const emptyDraft = (): Draft => ({
  date: romeDate(),
  categoryId: null,
  subcategory: null,
  amountText: "",
  note: "",
  accountId: null,
  direction: "from",
  tag: "",
});

export function NewEntry() {
  const reference = useReference();
  const [step, setStep] = useState<Step>("date");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState<TxnDraft | null>(null);
  const [created, setCreated] = useState<Category | null>(null);

  if (reference === undefined) return <Shell>{null}</Shell>;
  if (reference === null) return <Shell><FirstSyncNeeded /></Shell>;

  // Una categoria appena creata può non essere ancora nei dati locali: uso la copia tenuta a parte.
  const category = reference.categories.find((c) => c.id === draft.categoryId) ?? (created?.id === draft.categoryId ? created : null);
  const index = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);
  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  const back = () => setStep(STEPS[Math.max(index - 1, 0)]);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save(tag: string) {
    const cents = parseAmount(draft.amountText);
    if (!category || cents === null) return;
    const account = draft.accountId ?? reference!.accounts[0]?.id ?? null;
    const txn: TxnDraft = {
      id: crypto.randomUUID(),
      occurred_on: draft.date,
      type: txnType(draft.direction, category),
      amount_cents: cents,
      category_id: category.id,
      subcategory_id: draft.subcategory?.id ?? null,
      subcategory_name: draft.subcategory?.isNew ? draft.subcategory.name : null,
      account_id: account,
      note: draft.note.trim() || null,
      tag: tag.trim() || null,
      updated_at: new Date().toISOString(),
    };
    await saveTxn(txn);
    setSaved(txn);
  }

  if (saved) {
    return (
      <Shell>
        <Saved
          txn={saved}
          reference={reference}
          onAgain={() => {
            setSaved(null);
            setDraft(emptyDraft());
            setStep("date");
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell onBack={index > 0 ? back : undefined} progress={(index + 1) / STEPS.length}>
      {step === "date" && <QuickRepeat reference={reference} onSaved={setSaved} />}
      {step === "date" && (
        <DateStep
          value={draft.date}
          onPick={(date) => {
            update({ date });
            next();
          }}
        />
      )}
      {step === "category" && (
        <CategoryStep
          categories={reference.categories}
          selected={draft.categoryId}
          onPick={(c) => {
            if (!reference.categories.some((x) => x.id === c.id)) setCreated(c);
            // Cambiare categoria azzera la sottocategoria e reimposta entrata/uscita.
            if (c.id !== draft.categoryId) update({ categoryId: c.id, subcategory: null, direction: defaultDirection(c) });
            next();
          }}
        />
      )}
      {step === "subcategory" && category && (
        <SubcategoryStep
          category={category}
          options={reference.subcategories.filter((s) => s.category_id === category.id)}
          selected={draft.subcategory?.id ?? null}
          onPick={(subcategory) => {
            update({ subcategory });
            next();
          }}
        />
      )}
      {step === "amount" && (
        <AmountStep value={draft.amountText} onChange={(amountText) => update({ amountText })} onNext={next} />
      )}
      {step === "note" && <NoteStep value={draft.note} onChange={(note) => update({ note })} onNext={next} />}
      {step === "account" && category && (
        <AccountStep
          accounts={reference.accounts}
          selected={{ accountId: draft.accountId ?? reference.accounts[0]?.id ?? null, direction: draft.direction }}
          onPick={(accountId, direction) => {
            update({ accountId, direction });
            next();
          }}
        />
      )}
      {step === "tag" && (
        <TagStep
          tags={reference.tags}
          value={draft.tag}
          onChange={(tag) => update({ tag })}
          onSave={save}
          summary={
            <Summary
              draft={draft}
              category={category}
              accountName={reference.accounts.find((a) => a.id === (draft.accountId ?? reference.accounts[0]?.id))?.name}
              onEdit={go}
            />
          }
        />
      )}
    </Shell>
  );
}

// --- cornice ---------------------------------------------------------------------

function Shell({ children, onBack, progress }: { children: React.ReactNode; onBack?: () => void; progress?: number }) {
  return (
    <main className="page entry">
      <div className="entry-top">
        {onBack ? (
          <button type="button" className="link-button" onClick={onBack}>
            ‹ Indietro
          </button>
        ) : (
          <PageLink href="/" className="link-button">
            ‹ Home
          </PageLink>
        )}
        <SyncBadge />
      </div>
      {progress !== undefined && (
        <div className="progress" aria-hidden>
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {children}
    </main>
  );
}

function FirstSyncNeeded() {
  const s = useSyncState();
  return (
    <div className="stack">
      <h1>Nuovo movimento</h1>
      <p className="muted">
        {s.online
          ? "Sto scaricando categorie e sottocategorie…"
          : "Serve una connessione la prima volta, per scaricare categorie e sottocategorie. Poi funziona anche offline."}
      </p>
    </div>
  );
}

// --- passi -----------------------------------------------------------------------

function DateStep({ value, onPick }: { value: string; onPick: (d: string) => void }) {
  const choices = [romeDate(), romeDate(1), romeDate(2)];
  return (
    <section className="stack">
      <h1>Data</h1>
      <div className="choice-list">
        {choices.map((d, i) => (
          <button key={d} type="button" className={`choice ${value === d ? "selected" : ""}`} onClick={() => onPick(d)}>
            <strong>{["Oggi", "Ieri", "L'altro ieri"][i]}</strong>
            <span className="muted">{formatDay(d)}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Un altro giorno</span>
        <input type="date" defaultValue={value} max={romeDate()} onChange={(e) => e.target.value && onPick(e.target.value)} />
      </label>
    </section>
  );
}

const EMOJI_SUGGESTIONS = ["🐶", "👶", "🎮", "📚", "🍷", "🏋️", "💊", "🎨", "🚲", "🧾", "🛠️", "🌱"];

function CategoryStep({
  categories,
  selected,
  onPick,
}: {
  categories: Category[];
  selected: string | null;
  onPick: (c: Category) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="stack">
      <h1>Categoria</h1>
      <div className="category-grid">
        {categories.map((c) => (
          <button key={c.id} type="button" className={`category ${selected === c.id ? "selected" : ""}`} onClick={() => onPick(c)}>
            <span className="emoji" aria-hidden>
              {c.emoji}
            </span>
            <span>{c.name}</span>
          </button>
        ))}
        <button type="button" className="category category-add" onClick={() => setAdding(true)} aria-expanded={adding}>
          <span className="emoji" aria-hidden>
            +
          </span>
          <span>Nuova</span>
        </button>
      </div>
      {adding && <NewCategory onCreated={onPick} onCancel={() => setAdding(false)} />}
    </section>
  );
}

/** Crea una categoria quando la spesa non rientra in quelle esistenti (serve la connessione). */
function NewCategory({ onCreated, onCancel }: { onCreated: (c: Category) => void; onCancel: () => void }) {
  const { online } = useSyncState();
  const [emoji, setEmoji] = useState("🏷️");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("expense");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, emoji, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Creazione non riuscita");
      await flush(); // aggiorna categorie e sottocategorie sul telefono
      onCreated(data as Category);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creazione non riuscita");
      setBusy(false);
    }
  }

  return (
    <form
      className="card card-padded new-category"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void create();
      }}
    >
      <strong>Nuova categoria</strong>
      {!online && <p className="alert">Sei offline: per creare una categoria serve la connessione.</p>}
      <div className="new-category-row">
        <input
          className="emoji-input"
          value={emoji}
          onChange={(e) => setEmoji([...e.target.value.trim()].slice(-2).join("") || "")}
          aria-label="Emoji"
          maxLength={8}
        />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome, per esempio Animali" maxLength={40} autoFocus />
      </div>
      <div className="chip-list" aria-label="Emoji suggerite">
        {EMOJI_SUGGESTIONS.map((e) => (
          <button key={e} type="button" className={`chip chip-sm ${emoji === e ? "selected" : ""}`} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <div className="segmented segmented-3" role="group" aria-label="Tipo di categoria">
        {(
          [
            ["expense", "Spesa"],
            ["income", "Entrata"],
            ["investment", "Investimento"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? "selected" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className="button" disabled={!name.trim() || busy || !online}>
          {busy ? "Creo…" : "Crea e usa"}
        </button>
      </div>
    </form>
  );
}

function SubcategoryStep({
  category,
  options,
  selected,
  onPick,
}: {
  category: Category;
  options: { id: string; name: string }[];
  selected: string | null;
  onPick: (s: { id: string; name: string; isNew: boolean } | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const existing = options.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <section className="stack">
      <h1>
        {category.emoji} {category.name}
      </h1>
      <div className="chip-list">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`chip ${selected === o.id ? "selected" : ""}`}
            onClick={() => onPick({ id: o.id, name: o.name, isNew: false })}
          >
            {o.name}
          </button>
        ))}
        <button type="button" className="chip chip-add" onClick={() => setAdding(true)}>
          + Nuova
        </button>
      </div>
      {adding && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!trimmed) return;
            onPick(existing ? { ...existing, isNew: false } : { id: crypto.randomUUID(), name: trimmed, isNew: true });
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome della sottocategoria"
            autoFocus
            maxLength={60}
            enterKeyHint="next"
          />
          <button type="submit" className="button" disabled={!trimmed}>
            Aggiungi
          </button>
        </form>
      )}
      <button type="button" className="link-button" onClick={() => onPick(null)}>
        Nessuna sottocategoria
      </button>
    </section>
  );
}

function AmountStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  const cents = parseAmount(value);
  const invalid = value.trim() !== "" && cents === null;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (cents !== null) onNext();
      }}
    >
      <h1>Importo</h1>
      <div className="amount-input">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          autoFocus
          enterKeyHint="next"
          aria-label="Importo in euro"
          aria-invalid={invalid}
        />
        <span aria-hidden>€</span>
      </div>
      {invalid && <p className="alert">Scrivi un importo valido, per esempio 2,80.</p>}
      <button type="submit" className="button" disabled={cents === null}>
        Avanti
      </button>
    </form>
  );
}

function NoteStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      <h1>Note</h1>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Facoltative, per esempio: caffè con Marco"
        autoFocus
        maxLength={200}
        enterKeyHint="next"
      />
      <button type="submit" className="button">
        {value.trim() ? "Avanti" : "Salta"}
      </button>
    </form>
  );
}

function AccountStep({
  accounts,
  selected,
  onPick,
}: {
  accounts: { id: string; name: string }[];
  selected: { accountId: string | null; direction: Direction };
  onPick: (accountId: string, direction: Direction) => void;
}) {
  return (
    <section className="stack">
      <h1>Conto</h1>
      <div className="choice-list">
        {accounts.flatMap((a) =>
          (["from", "to"] as const).map((dir) => (
            <button
              key={`${a.id}-${dir}`}
              type="button"
              className={`choice ${selected.accountId === a.id && selected.direction === dir ? "selected" : ""}`}
              onClick={() => onPick(a.id, dir)}
            >
              <strong>
                {dir === "from" ? "Da" : "A"} {a.name}
              </strong>
              <span className="muted">{dir === "from" ? "Uscita: soldi che escono dal conto" : "Entrata: stipendi, rimborsi, storni"}</span>
            </button>
          )),
        )}
      </div>
    </section>
  );
}

function TagStep({
  tags,
  value,
  onChange,
  onSave,
  summary,
}: {
  tags: string[];
  value: string;
  onChange: (v: string) => void;
  onSave: (tag: string) => Promise<void>;
  summary: React.ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const submitted = useRef(false);
  const recent = useMemo(() => tags.slice(0, 6), [tags]);

  async function submit(tag: string) {
    if (submitted.current) return; // niente doppio salvataggio con doppio tocco
    submitted.current = true;
    setSaving(true);
    await onSave(tag);
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(value);
      }}
    >
      <h1>Tag</h1>
      <p className="muted">Facoltativo: per viaggi o eventi, per esempio &quot;Giappone - 2025&quot;.</p>
      {recent.length > 0 && (
        <div className="chip-list">
          {recent.map((t) => (
            <button key={t} type="button" className={`chip ${value === t ? "selected" : ""}`} onClick={() => onChange(value === t ? "" : t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Nessun tag" maxLength={60} enterKeyHint="done" />
      {summary}
      <button type="submit" className="button button-big" disabled={saving}>
        {saving ? "Salvo…" : "Salva"}
      </button>
    </form>
  );
}

function Summary({
  draft,
  category,
  accountName,
  onEdit,
}: {
  draft: Draft;
  category: Category | null;
  accountName?: string;
  onEdit: (s: Step) => void;
}) {
  const cents = parseAmount(draft.amountText);
  const rows: [Step, string, string][] = [
    ["date", "Data", relativeDay(draft.date)],
    ["category", "Categoria", category ? `${category.emoji} ${category.name}` : "—"],
    ["subcategory", "Sottocategoria", draft.subcategory?.name ?? "—"],
    ["amount", "Importo", cents !== null ? formatCents(cents) : "—"],
    ["note", "Note", draft.note.trim() || "—"],
    ["account", "Conto", `${draft.direction === "from" ? "Da" : "A"} ${accountName ?? "—"}`],
  ];
  return (
    <div className="summary card" role="group" aria-label="Riepilogo: tocca una riga per modificarla">
      {rows.map(([step, label, value]) => (
        <button key={step} type="button" className="summary-row" onClick={() => onEdit(step)}>
          <span className="summary-label">{label}</span>
          <span>{value}</span>
        </button>
      ))}
    </div>
  );
}

function Saved({ txn, reference, onAgain }: { txn: TxnDraft; reference: Reference; onAgain: () => void }) {
  const s = useSyncState();
  const category = reference.categories.find((c) => c.id === txn.category_id);
  const sub = txn.subcategory_name ?? reference.subcategories.find((x) => x.id === txn.subcategory_id)?.name;
  return (
    <section className="stack saved">
      <div className="saved-check" aria-hidden>
        ✓
      </div>
      <h1>Salvato</h1>
      <p className="saved-amount">
        {txn.type === "income" ? "+" : ""}
        {formatCents(txn.amount_cents)}
      </p>
      <p className="muted">
        {category?.emoji} {category?.name}
        {sub ? ` · ${sub}` : ""} · {relativeDay(txn.occurred_on)}
      </p>
      {!s.online && <p className="muted">Sei offline: lo sincronizzo appena torna la rete.</p>}
      <button type="button" className="button button-big" onClick={onAgain} autoFocus>
        Nuovo movimento
      </button>
      <PageLink href="/movimenti" className="button button-secondary">
        Vedi i movimenti
      </PageLink>
    </section>
  );
}
