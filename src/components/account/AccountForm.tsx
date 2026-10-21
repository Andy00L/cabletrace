"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, signUp, type AccountFormState } from "@/lib/auth/account-actions";
import { MIN_PASSWORD_LENGTH, type AccountMode } from "@/lib/auth/credentials";

const MODE_COPY: Record<AccountMode, { title: string; subtitle: string; submit: string; pending: string; switchPrompt: string; switchLabel: string; switchPath: string }> = {
  "sign-in": {
    title: "Sign in to CableTrace",
    subtitle: "An account opens the console, the live watch and your watchlist.",
    submit: "Sign in",
    pending: "Signing in…",
    switchPrompt: "No account yet?",
    switchLabel: "Create one",
    switchPath: "/sign-up",
  },
  "sign-up": {
    title: "Create your CableTrace account",
    subtitle: "Anyone can create one. It opens the console, the live watch and your watchlist.",
    submit: "Create account",
    pending: "Creating your account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in",
    switchPath: "/sign-in",
  },
};

const INITIAL_STATE: AccountFormState = { error: null, email: "" };
const FIELD_CLASS = "h-11 w-full rounded-field bg-card px-3.5 text-body text-ink placeholder:text-faint";

/**
 * The email and password form of the sign-in and sign-up pages (board 16: a plate on the paper, one ink action).
 * The server action checks everything and signs the reader in; the form works before its script loads. Afterwards
 * the reader goes on to `nextPath`, the page that sent them here.
 */
export function AccountForm({ mode, nextPath }: { mode: AccountMode; nextPath: string }) {
  const [state, formAction, isPending] = useActionState(mode === "sign-in" ? signIn : signUp, INITIAL_STATE);
  const copy = MODE_COPY[mode];
  const errorId = `${mode}-error`;
  const hintId = `${mode}-password-hint`;

  return (
    <form action={formAction} noValidate className="flex w-full flex-col gap-6 rounded-card border border-ink/20 bg-paper px-6 pt-8 pb-6 shadow-raised sm:px-8" data-testid="account-form">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-heading text-ink">{copy.title}</h1>
        <p className="text-small text-muted">{copy.subtitle}</p>
      </div>
      <input type="hidden" name="next" value={nextPath} />
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email}
            aria-invalid={state.error !== null}
            aria-describedby={state.error ? errorId : undefined}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Password</span>
          <input
            type="password"
            name="password"
            required
            minLength={mode === "sign-up" ? MIN_PASSWORD_LENGTH : undefined}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            aria-invalid={state.error !== null}
            aria-describedby={[state.error ? errorId : null, mode === "sign-up" ? hintId : null].filter((id) => id !== null).join(" ") || undefined}
            className={FIELD_CLASS}
          />
          {mode === "sign-up" && (
            <span id={hintId} className="text-caption font-normal text-muted">
              At least {MIN_PASSWORD_LENGTH} characters.
            </span>
          )}
        </label>
      </div>
      {state.error && (
        <p id={errorId} role="alert" className="rounded-field bg-card px-3.5 py-2.5 text-small text-alarm" data-testid="account-form-error">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="flex h-12 items-center justify-center rounded-full bg-ink px-6 text-label text-card transition-colors duration-140 ease-standard hover:bg-ink-hover disabled:opacity-70"
      >
        {isPending ? copy.pending : copy.submit}
      </button>
      <p className="text-small text-muted">
        {copy.switchPrompt}{" "}
        <Link href={`${copy.switchPath}?next=${encodeURIComponent(nextPath)}`} className="text-ink underline decoration-faint underline-offset-4 hover:decoration-ink">
          {copy.switchLabel}
        </Link>
      </p>
    </form>
  );
}
