"use server";

import { createClient, type AuthError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Result } from "@/lib/result";
import { parseCredentials, readFormText, type Credentials } from "@/lib/auth/credentials";
import { readSafeNextPath } from "@/lib/auth/next-path";
import { createSessionClient } from "@/lib/auth/session";
import { readSupabaseKeys } from "@/lib/auth/supabase-keys";

// The server actions behind the sign-in and sign-up forms (src/components/account/AccountForm.tsx) and the sign-out
// button. Next checks each action's Origin against the host, so another site cannot post them. Each failure returns
// a sentence for the reader; details go to the logs. redirect() ends an action by throwing Next's own signal, which
// the framework catches: it is how a successful action hands over, not an error.

export type AccountFormState = { error: string | null; email: string };

const UNAVAILABLE = "Accounts cannot be reached just now. Try again in a minute.";
// The session cookies are named sb-<project ref>-auth-token, with .0, .1 chunks when long.
// sourceRef: node_modules/@supabase/auth-js/dist/main/GoTrueClient.js (storageKey) and @supabase/ssr chunker.
const SESSION_COOKIE_PREFIX = "sb-";

function describeSignInError(error: AuthError): string {
  if (error.code === "invalid_credentials") return "That email and password do not match an account.";
  if (error.code === "over_request_rate_limit") return "Too many attempts from here. Wait a few minutes and try again.";
  console.error(`[describeSignInError] ${error.status ?? "no status"} ${error.code ?? "no code"}: ${error.message}`);
  return UNAVAILABLE;
}

/** Signs the form's reader in on this request's session cookies. */
async function startSession(credentials: Credentials): Promise<string | null> {
  const client = await createSessionClient();
  if (!client.ok) {
    console.error(`[startSession] ${client.reason}`);
    return UNAVAILABLE;
  }
  const { error } = await client.value.auth.signInWithPassword(credentials);
  return error ? describeSignInError(error) : null;
}

export async function signIn(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const email = readFormText(formData, "email");
  const credentials = parseCredentials(formData, "sign-in");
  if (!credentials.ok) return { error: credentials.reason, email };
  const failure = await startSession(credentials.value);
  if (failure !== null) return { error: failure, email };
  redirect(readSafeNextPath(formData.get("next")));
}

type NewAccountOutcome = "created" | "email-taken" | "weak-password" | "invalid-email";

/**
 * Creates a confirmed account with the secret key. Supabase's built-in mailer sends only to the project's team, at 2
 * emails an hour (https://supabase.com/docs/guides/auth/auth-smtp, read 21 Oct 2026), so a confirmation email could
 * never reach a reader; the account opens at once instead, and its address is never checked.
 */
async function createConfirmedAccount(credentials: Credentials): Promise<Result<NewAccountOutcome>> {
  const keys = readSupabaseKeys();
  if (!keys.ok) return keys;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return { ok: false, reason: "SUPABASE_SECRET_KEY is not set" };
  const admin = createClient(keys.value.url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
  if (!error) return { ok: true, value: "created" };
  if (error.code === "email_exists" || error.code === "user_already_exists") return { ok: true, value: "email-taken" };
  if (error.code === "weak_password") return { ok: true, value: "weak-password" };
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return { ok: true, value: "invalid-email" };
  return { ok: false, reason: `${error.status ?? "no status"} ${error.code ?? "no code"}: ${error.message}` };
}

export async function signUp(_previous: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const email = readFormText(formData, "email");
  const credentials = parseCredentials(formData, "sign-up");
  if (!credentials.ok) return { error: credentials.reason, email };
  const created = await createConfirmedAccount(credentials.value);
  if (!created.ok) {
    console.error(`[signUp] ${created.reason}`);
    return { error: UNAVAILABLE, email };
  }
  switch (created.value) {
    case "created":
      break;
    case "email-taken":
      return { error: "An account already uses this email. Sign in instead.", email };
    case "weak-password":
      return { error: "That password is too easy to guess. Try a longer one.", email };
    case "invalid-email":
      return { error: "Enter a valid email address.", email };
    default: {
      const unhandledOutcome: never = created.value;
      return unhandledOutcome;
    }
  }
  const failure = await startSession(credentials.value);
  if (failure !== null) return { error: failure, email };
  redirect(readSafeNextPath(formData.get("next")));
}

/**
 * Ends this browser's session only: the test readers share accounts, so their other sessions stay open. When Supabase
 * cannot be reached the library keeps the session, so its cookies are dropped here: this browser is signed out either way.
 */
export async function signOut(): Promise<void> {
  const client = await createSessionClient();
  const failure = client.ok ? (await client.value.auth.signOut({ scope: "local" })).error?.message : client.reason;
  if (failure) {
    console.error(`[signOut] ${failure}`);
    const cookieStore = await cookies();
    cookieStore.getAll().filter((cookie) => cookie.name.startsWith(SESSION_COOKIE_PREFIX)).forEach((cookie) => cookieStore.delete(cookie.name));
  }
  redirect("/");
}
