"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { centsToInput, parseAmount } from "@/lib/entry/amount";
import type { Goal, goalProgress } from "@/lib/analytics/insights";
import { formatEuros, formatPercent } from "@/lib/format";
import { addToGoal, archiveGoal, saveGoal, type GoalResult } from "./actions";

type Item = { goal: Goal; progress: ReturnType<typeof goalProgress> };
const EMOJIS = ["🎯", "✈️", "🏖️", "🎁", "🚗", "🏠", "💻", "🎓", "💍", "🛟"];
const fmtDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function GoalsManager({ goals, today }: { goals: Item[]; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Goal | "new" | null>(goals.length ? null : "new");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<GoalResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setError(null);
        after?.();
        router.refresh();
      } else setError(res.error);
    });

  return (
    <>
      {error && <p className="alert">{error}</p>}
      {goals.map(({ goal, progress }) =>
        editing !== "new" && editing?.id === goal.id ? (
          <GoalForm key={goal.id} goal={goal} today={today} pending={pending} onCancel={() => setEditing(null)} onSave={(g) => run(() => saveGoal({ id: goal.id, ...g }), () => setEditing(null))} />
        ) : (
          <article key={goal.id} className="card card-padded goal">
            <div className="goal-head">
              <span className="goal-emoji" aria-hidden>
                {goal.emoji}
              </span>
              <div className="goal-main">
                <strong>{goal.name}</strong>
                <span className="muted small">
                  {formatEuros(goal.saved_cents)} di {formatEuros(goal.target_cents)}
                  {goal.target_date ? ` · entro il ${fmtDate.format(new Date(`${goal.target_date}T00:00:00Z`))}` : ""}
                </span>
              </div>
              <span className="goal-pct">{formatPercent(progress.ratio).replace(",0%", "%")}</span>
            </div>
            <div className={`meter ${progress.done ? "meter-ok" : progress.overdue ? "meter-over" : ""}`} role="meter" aria-valuenow={Math.round(progress.ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${goal.name}: ${formatPercent(progress.ratio)}`}>
              <div className="meter-fill" style={{ width: `${progress.ratio * 100}%` }} />
            </div>
            <p className="goal-advice">
              {progress.done
                ? "🎉 Obiettivo raggiunto!"
                : progress.overdue
                  ? `La data è passata: mancano ${formatEuros(progress.remaining)}.`
                  : progress.perMonth !== null
                    ? `Metti da parte ${formatEuros(progress.perMonth)} al mese per ${progress.monthsLeft} ${progress.monthsLeft === 1 ? "mese" : "mesi"}.`
                    : `Mancano ${formatEuros(progress.remaining)}.`}
            </p>
            <Contribute disabled={pending} onAdd={(cents) => run(() => addToGoal(goal.id, cents))} />
            <div className="goal-actions">
              <button type="button" className="link-button small" onClick={() => setEditing(goal)}>
                Modifica
              </button>
              <button
                type="button"
                className="link-button small"
                onClick={() => window.confirm(`Archiviare "${goal.name}"?`) && run(() => archiveGoal(goal.id))}
              >
                {progress.done ? "Archivia" : "Rinuncia"}
              </button>
            </div>
          </article>
        ),
      )}
      {editing === "new" ? (
        <GoalForm today={today} pending={pending} onCancel={goals.length ? () => setEditing(null) : undefined} onSave={(g) => run(() => saveGoal(g), () => setEditing(null))} />
      ) : (
        <button type="button" className="button button-secondary" onClick={() => setEditing("new")}>
          + Nuovo obiettivo
        </button>
      )}
    </>
  );
}

function Contribute({ onAdd, disabled }: { onAdd: (cents: number) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  const cents = parseAmount(value);
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (cents) {
          onAdd(cents);
          setValue("");
        }
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Aggiungi, per esempio 50" aria-label="Importo da aggiungere" />
      <button type="submit" className="button" disabled={!cents || disabled}>
        Aggiungi
      </button>
    </form>
  );
}

function GoalForm({
  goal,
  today,
  pending,
  onSave,
  onCancel,
}: {
  goal?: Goal;
  today: string;
  pending: boolean;
  onSave: (g: { name: string; emoji: string; targetCents: number; targetDate: string | null }) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? "");
  const [emoji, setEmoji] = useState(goal?.emoji ?? "🎯");
  const [target, setTarget] = useState(goal ? centsToInput(goal.target_cents).replace(/,00$/, "") : "");
  const [date, setDate] = useState(goal?.target_date ?? "");
  const cents = parseAmount(target);
  return (
    <form
      className="card card-padded goal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (cents && name.trim()) onSave({ name, emoji, targetCents: cents, targetDate: date || null });
      }}
    >
      <strong>{goal ? "Modifica obiettivo" : "Nuovo obiettivo"}</strong>
      <div className="chip-list" role="radiogroup" aria-label="Icona">
        {EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={emoji === e} className={`chip chip-sm ${emoji === e ? "selected" : ""}`} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Viaggio a dicembre" maxLength={60} required />
      </label>
      <label className="field">
        <span>Cifra da mettere da parte (€)</span>
        <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="800" required />
      </label>
      <label className="field">
        <span>Entro il (facoltativo)</span>
        <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="button-row">
        {onCancel ? (
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Annulla
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button" disabled={!cents || !name.trim() || pending}>
          Salva
        </button>
      </div>
    </form>
  );
}
