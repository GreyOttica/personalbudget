"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AnalyticsCategory, AnalyticsSubcategory } from "@/lib/analytics/dashboard";
import type { Recurring, RecurringRule } from "@/lib/analytics/insights";
import { centsToInput, parseAmount } from "@/lib/entry/amount";
import { formatCents, formatEuros } from "@/lib/format";
import { deleteRule, saveRule, type RuleInput } from "./actions";

type Rule = RecurringRule & { next: string };
type Props = {
  today: string;
  rules: Rule[];
  detected: Recurring[];
  categories: AnalyticsCategory[];
  subcategories: AnalyticsSubcategory[];
  accounts: { id: string; name: string }[];
};

const dayFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));
const TYPE_LABEL = { expense: "Uscita", income: "Entrata", investment: "Investimento" } as const;

export function RecurringManager(props: Props) {
  const { rules, detected, categories, today } = props;
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null); // id regola, "new" o "d:<chiave>"
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const cat = (id: string) => categories.find((c) => c.id === id);
  const monthly = rules.filter((r) => r.active && r.type === "expense").reduce((s, r) => s + r.amount_cents, 0);

  const save = (input: RuleInput) =>
    start(async () => {
      const res = await saveRule(input);
      if (res.ok) {
        setEditing(null);
        setMessage({ ok: true, text: res.created ? `Salvato. Ho registrato ${res.created} addebiti già dovuti.` : "Salvato." });
        router.refresh();
      } else setMessage({ ok: false, text: res.error });
    });
  const remove = (r: Rule) => {
    if (!window.confirm(`Eliminare il ricorrente "${r.name}"? I movimenti già registrati restano.`)) return;
    start(async () => {
      const res = await deleteRule(r.id);
      setMessage(res.ok ? { ok: true, text: "Ricorrente eliminato." } : { ok: false, text: res.error });
      router.refresh();
    });
  };

  return (
    <>
      <section className="card hero">
        <p className="hero-label">Uscite automatiche</p>
        <p className="hero-value">{formatEuros(monthly)}</p>
        <p className="muted">al mese · {formatEuros(monthly * 12)} l&apos;anno</p>
      </section>
      {message && <p className={message.ok ? "ok" : "alert"}>{message.text}</p>}

      <h2 className="group-title">Automatici</h2>
      {rules.length === 0 && editing !== "new" && (
        <p className="muted small group-note">Nessun ricorrente automatico. Rendi automatici quelli riconosciuti qui sotto, oppure aggiungine uno.</p>
      )}
      {rules.length > 0 && (
        <ul className="list">
          {rules.map((r) =>
            editing === r.id ? (
              <li key={r.id} className="list-form">
                <RuleForm
                  {...props}
                  pending={pending}
                  initial={{
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    amountCents: r.amount_cents,
                    categoryId: r.category_id,
                    subcategoryId: r.subcategory_id,
                    accountId: r.account_id,
                    dayOfMonth: r.day_of_month,
                    startsOn: r.starts_on,
                    active: r.active,
                  }}
                  onCancel={() => setEditing(null)}
                  onSave={save}
                  onDelete={() => remove(r)}
                />
              </li>
            ) : (
              <li key={r.id} className={`list-row ${r.active ? "" : "inactive"}`}>
                <span className="cat-emoji" aria-hidden>
                  {cat(r.category_id)?.emoji ?? "•"}
                </span>
                <div className="list-main">
                  <strong>{r.name}</strong>
                  <span className="muted small">
                    {r.active ? `ogni mese il ${r.day_of_month} · prossimo ${fmtDay(r.next)}` : "in pausa"}
                    {r.type !== "expense" ? ` · ${TYPE_LABEL[r.type].toLowerCase()}` : ""}
                  </span>
                </div>
                <span className="list-amount">{formatCents(r.amount_cents)}</span>
                <button type="button" className="icon-button" aria-label={`Modifica ${r.name}`} onClick={() => setEditing(r.id)}>
                  <PencilIcon />
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {editing === "new" ? (
        <div className="list list-form">
          <RuleForm {...props} pending={pending} onCancel={() => setEditing(null)} onSave={save} />
        </div>
      ) : (
        <button type="button" className="button button-secondary" onClick={() => setEditing("new")}>
          + Nuovo ricorrente
        </button>
      )}

      {detected.length > 0 && (
        <>
          <h2 className="group-title">Riconosciuti nello storico</h2>
          <p className="muted small group-note">Si ripetono ogni mese con un importo simile, ma li registri ancora a mano.</p>
          <ul className="list">
            {detected.map((d) => {
              const key = `d:${d.categoryId}|${d.subcategoryId ?? ""}`;
              return editing === key ? (
                <li key={key} className="list-form">
                  <RuleForm
                    {...props}
                    pending={pending}
                    initial={{
                      name: d.name,
                      type: "expense",
                      amountCents: d.last,
                      categoryId: d.categoryId,
                      subcategoryId: d.subcategoryId,
                      accountId: props.accounts[0]?.id ?? null,
                      dayOfMonth: Number(d.lastDate.slice(8, 10)),
                      startsOn: d.nextDate > today ? d.nextDate : today,
                      active: true,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={save}
                  />
                </li>
              ) : (
                <li key={key} className="list-row">
                  <span className="cat-emoji" aria-hidden>
                    {d.emoji}
                  </span>
                  <div className="list-main">
                    <strong>{d.name}</strong>
                    <span className="muted small">
                      {d.months} mesi su 6 · ultimo il {fmtDay(d.lastDate)}
                      {d.changed && d.previous !== null ? ` · era ${formatCents(d.previous)}` : ""}
                    </span>
                  </div>
                  <span className="list-amount">{formatCents(d.last)}</span>
                  <button type="button" className="button button-tinted button-compact" onClick={() => setEditing(key)}>
                    Automatico
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function RuleForm({
  initial,
  categories,
  subcategories,
  accounts,
  today,
  pending,
  onSave,
  onCancel,
  onDelete,
}: Props & {
  initial?: RuleInput;
  pending: boolean;
  onSave: (r: RuleInput) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<RuleInput["type"]>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories.find((c) => c.is_fixed)?.id ?? categories[0]?.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(initial?.subcategoryId ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [day, setDay] = useState(String(initial?.dayOfMonth ?? Number(today.slice(8, 10))));
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? today);
  const [active, setActive] = useState(initial?.active ?? true);
  const cents = parseAmount(amount);
  const dayN = Number(day);
  const valid = !!name.trim() && cents !== null && Number.isInteger(dayN) && dayN >= 1 && dayN <= 31 && !!categoryId && !!startsOn;
  const subs = subcategories.filter((s) => s.category_id === categoryId);
  const isEdit = !!initial?.id;

  return (
    <form
      className="rule-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid)
          onSave({
            id: initial?.id,
            name,
            type,
            amountCents: cents!,
            categoryId,
            subcategoryId: subcategoryId || null,
            accountId: accountId || null,
            dayOfMonth: dayN,
            startsOn,
            active,
          });
      }}
    >
      <div className="segmented segmented-3" role="group" aria-label="Tipo">
        {(["expense", "income", "investment"] as const).map((t) => (
          <button key={t} type="button" className={type === t ? "selected" : ""} aria-pressed={type === t} onClick={() => setType(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Affitto" maxLength={60} />
      </label>
      <div className="form-row">
        <label className="field">
          <span>Importo (€)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="900" aria-invalid={amount !== "" && cents === null} />
        </label>
        <label className="field field-day">
          <span>Giorno</span>
          <input value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" aria-invalid={!(dayN >= 1 && dayN <= 31)} />
        </label>
      </div>
      <label className="field">
        <span>Categoria</span>
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setSubcategoryId("");
          }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </label>
      {subs.length > 0 && (
        <label className="field">
          <span>Sottocategoria</span>
          <select value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)}>
            <option value="">Nessuna</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {accounts.length > 1 && (
        <label className="field">
          <span>Conto</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>{isEdit ? "Attivo dal" : "Primo addebito da registrare"}</span>
        <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </label>
      <p className="muted small">
        {isEdit
          ? "Le modifiche valgono per gli addebiti dei prossimi mesi: quelli già registrati non cambiano (puoi modificarli da Movimenti)."
          : "Se l'addebito di questo mese l'hai già registrato a mano, scegli una data del mese prossimo per non averlo doppio."}
      </p>
      {isEdit && (
        <label className="switch-row">
          <span>Attivo</span>
          <input type="checkbox" role="switch" className="switch" checked={active} onChange={(e) => setActive(e.target.checked)} />
        </label>
      )}
      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Annulla
        </button>
        <button type="submit" className="button" disabled={!valid || pending}>
          {pending ? "Salvo…" : "Salva"}
        </button>
      </div>
      {onDelete && (
        <button type="button" className="link-button danger-link" onClick={onDelete}>
          Elimina ricorrente
        </button>
      )}
    </form>
  );
}
