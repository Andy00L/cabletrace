import type { Result } from "@/lib/result";

// The email and password a reader types into the sign-in or sign-up form, checked before Supabase Auth sees them.

export type AccountMode = "sign-in" | "sign-up";
export type Credentials = { email: string; password: string };

// RFC 5321 caps an address at 254 characters.
const MAX_EMAIL_LENGTH = 254;
// Ours; Supabase Auth's own floor is 6 (project default). Sign-in does not apply it, so the check never locks anyone out.
export const MIN_PASSWORD_LENGTH = 8;
// Supabase Auth hashes passwords with bcrypt, which reads at most 72 bytes.
const MAX_PASSWORD_BYTES = 72;
// One @, something on each side, a dot in the domain: Supabase Auth runs the full check.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** A text field of the form, trimmed when asked; "" when missing or not text. */
export function readFormText(formData: FormData, name: string, shouldTrim = true): string {
  const value = formData.get(name);
  if (typeof value !== "string") return "";
  return shouldTrim ? value.trim() : value;
}

/** Checks the form's email and password; the reason is written for the reader. */
export function parseCredentials(formData: FormData, mode: AccountMode): Result<Credentials> {
  const email = readFormText(formData, "email").toLowerCase();
  // A password is taken as typed: spaces at either end are part of it.
  const password = readFormText(formData, "password", false);
  if (email.length === 0) return { ok: false, reason: "Enter your email address." };
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return { ok: false, reason: "Enter a valid email address." };
  if (password.length === 0) return { ok: false, reason: "Enter your password." };
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return { ok: false, reason: `Use a password of at most ${MAX_PASSWORD_BYTES} characters.` };
  if (mode === "sign-up" && password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` };
  return { ok: true, value: { email, password } };
}
