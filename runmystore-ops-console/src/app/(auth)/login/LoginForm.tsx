"use client";
import { useActionState } from "react";
import { sendMagicLink, signInWithGoogle, type LoginState } from "./actions";

export function LoginForm({ next, initialError, google }: { next: string; initialError: string | null; google: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { ok: false, error: initialError });
  if (state.ok) {
    return (
      <div className="grid gap-2" role="status">
        <p className="title text-lg">Check your email</p>
        <p className="text-dim text-sm">If {state.email} is on the team, a sign-in link is on its way. It works once and expires in an hour.</p>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span className="label text-dim">Work email</span>
        <input className="input" type="email" name="email" required autoComplete="email" autoFocus placeholder="you@runmystore.com" />
      </label>
      {state.error && <p className="text-sm" style={{ color: "#f5a37a" }} role="alert">{state.error}</p>}
      <button className="btn justify-center" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a link"} <span className="arrow" aria-hidden="true">→</span>
      </button>
      {google && (
        <>
          <p className="text-center text-xs text-dim">or</p>
          <button className="btn ghost justify-center" type="submit" formAction={signInWithGoogle} disabled={pending}>Continue with Google</button>
        </>
      )}
    </form>
  );
}
