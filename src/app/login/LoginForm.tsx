"use client";

import { useActionState, useState } from "react";
import { requestCode, verifyCode, type LoginState } from "./actions";

const initial: LoginState = { step: "email", email: "" };

export function LoginForm({ notice }: { notice?: string }) {
  const [emailState, sendCode, sending] = useActionState(requestCode, initial);
  const [restart, setRestart] = useState(0);

  if (emailState.step === "code") {
    return <CodeStep key={restart} start={emailState} onBack={() => setRestart((n) => n + 1)} />;
  }

  return (
    <form action={sendCode} className="stack">
      {notice && <p className="alert">{notice}</p>}
      <label className="field">
        <span>Email</span>
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          defaultValue={emailState.email}
          required
        />
      </label>
      {emailState.error && <p className="alert">{emailState.error}</p>}
      <button type="submit" className="button" disabled={sending}>
        {sending ? "Invio…" : "Mandami il codice"}
      </button>
    </form>
  );
}

function CodeStep({ start, onBack }: { start: LoginState; onBack: () => void }) {
  const [state, verify, verifying] = useActionState(verifyCode, start);
  const [, resend, resending] = useActionState(requestCode, start);

  return (
    <div className="stack">
      <form action={verify} className="stack">
        {state.info && <p className="muted">{state.info}</p>}
        <label className="field">
          <span>Codice</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            className="code-input"
            autoFocus
            required
          />
        </label>
        {state.error && <p className="alert">{state.error}</p>}
        <button type="submit" className="button" disabled={verifying}>
          {verifying ? "Verifica…" : "Entra"}
        </button>
      </form>
      <form action={resend}>
        <input type="hidden" name="email" value={start.email} />
        <button type="submit" className="link-button" disabled={resending}>
          {resending ? "Invio…" : "Mandami un nuovo codice"}
        </button>
      </form>
      <button type="button" className="link-button" onClick={onBack}>
        Cambia email
      </button>
    </div>
  );
}
