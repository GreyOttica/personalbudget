"use client";

import { useState, useSyncExternalStore } from "react";
import { ACCENTS, readPrefs, savePrefs, THEME_MODES, type ThemePrefs } from "@/lib/theme";

// Le preferenze stanno nel browser: le leggo solo lato client (sul server non esistono).
const subscribe = () => () => {};

export function AppearanceSettings() {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [prefs, setPrefs] = useState<ThemePrefs | null>(null);
  const current = prefs ?? (hydrated ? readPrefs() : null);

  function update(patch: Partial<ThemePrefs>) {
    if (!current) return;
    const next = { ...current, ...patch };
    setPrefs(next);
    savePrefs(next);
  }

  return (
    <>
      <h2 className="group-title">Tema</h2>
      <div className="theme-grid" role="radiogroup" aria-label="Tema">
        {THEME_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={current?.mode === m.id}
            className={`theme-option ${current?.mode === m.id ? "selected" : ""}`}
            onClick={() => update({ mode: m.id })}
          >
            <span className={`theme-preview preview-${m.id}`} aria-hidden>
              <span className="preview-card">
                <span className="preview-line" />
                <span className="preview-line short" />
                <span className="preview-bar" />
              </span>
            </span>
            <strong>{m.label}</strong>
            <span className="muted small">{m.hint}</span>
          </button>
        ))}
      </div>

      <h2 className="group-title">Colore</h2>
      <div className="card card-padded">
        <div className="accent-list" role="radiogroup" aria-label="Colore di accento">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={current?.accent === a.id}
              aria-label={a.label}
              className={`accent-option ${current?.accent === a.id ? "selected" : ""}`}
              onClick={() => update({ accent: a.id })}
            >
              <span className="accent-swatch" style={{ background: `linear-gradient(135deg, ${a.light} 50%, ${a.dark} 50%)` }} />
              <span className="small">{a.label}</span>
            </button>
          ))}
        </div>
        <p className="muted small">
          Cambia pulsanti, selezioni e barre del budget. I colori dei grafici restano fissi (blu spese, verde entrate),
          così li leggi sempre allo stesso modo.
        </p>
      </div>
      <p className="muted small">Le preferenze valgono su questo dispositivo.</p>
    </>
  );
}
