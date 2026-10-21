import { describe, expect, test } from "bun:test";
import { parseCredentials } from "./credentials";
import { AFTER_SIGN_IN_PATH, buildSignInPath, readSafeNextPath, restoreReadableQuery } from "./next-path";
import { readReaderFromClaims } from "./supabase-keys";

function formWith(fields: Record<string, string>): FormData {
  const formData = new FormData();
  Object.entries(fields).forEach(([name, value]) => formData.set(name, value));
  return formData;
}

describe("readSafeNextPath", () => {
  test("keeps a replay deep link whole", () => {
    expect(readSafeNextPath("/cases/eagle-s-2024?t=2024-12-25T16:44Z&view=closeup")).toBe("/cases/eagle-s-2024?t=2024-12-25T16:44Z&view=closeup");
  });

  test("sends anything off this site, or back to the form, to the console", () => {
    for (const value of ["https://evil.example/", "//evil.example/", "/\\evil.example/", "/\t/evil.example/", "evil", "", "/sign-in?next=/live", "/sign-up"]) {
      expect(readSafeNextPath(value)).toBe(AFTER_SIGN_IN_PATH);
    }
    expect(readSafeNextPath(undefined)).toBe(AFTER_SIGN_IN_PATH);
    expect(readSafeNextPath(["/live", "/watchlist"])).toBe(AFTER_SIGN_IN_PATH);
    expect(readSafeNextPath(`/${"a".repeat(3_000)}`)).toBe(AFTER_SIGN_IN_PATH);
  });

  test("survives the round trip through the sign-in link", () => {
    const deepLink = "/cases/eagle-s-2024?t=2024-12-25T16:44Z&view=closeup";
    const nextValue = new URL(buildSignInPath(deepLink), "https://cabletrace.vercel.app").searchParams.get("next");
    expect(readSafeNextPath(nextValue)).toBe(deepLink);
  });
});

describe("restoreReadableQuery", () => {
  test("undoes the escapes Next adds to a deep link's time and leaves real escapes alone", () => {
    expect(restoreReadableQuery("?t=2024-12-25T16%3A44Z&view=closeup")).toBe("?t=2024-12-25T16:44Z&view=closeup");
    expect(new URLSearchParams(restoreReadableQuery("?t=2024-12-25T16%3A44Z")).get("t")).toBe("2024-12-25T16:44Z");
    expect(restoreReadableQuery("?q=a%26b")).toBe("?q=a%26b");
  });
});

describe("parseCredentials", () => {
  test("lowercases and trims the email and keeps the password as typed", () => {
    const parsed = parseCredentials(formWith({ email: "  Reader@Example.COM ", password: " pass word " }), "sign-in");
    expect(parsed).toEqual({ ok: true, value: { email: "reader@example.com", password: " pass word " } });
  });

  test("asks for each missing or malformed field", () => {
    expect(parseCredentials(formWith({ password: "longenough" }), "sign-in").ok).toBe(false);
    expect(parseCredentials(formWith({ email: "not-an-address", password: "longenough" }), "sign-in").ok).toBe(false);
    expect(parseCredentials(formWith({ email: "reader@example.com" }), "sign-in").ok).toBe(false);
    expect(parseCredentials(formWith({ email: "reader@example.com", password: "x".repeat(73) }), "sign-in").ok).toBe(false);
  });

  test("holds a new account to 8 characters but lets an older short password sign in", () => {
    expect(parseCredentials(formWith({ email: "reader@example.com", password: "short7!" }), "sign-up").ok).toBe(false);
    expect(parseCredentials(formWith({ email: "reader@example.com", password: "short7!" }), "sign-in").ok).toBe(true);
  });
});

describe("readReaderFromClaims", () => {
  test("names the reader from a token's sub and email, and nobody without a sub", () => {
    expect(readReaderFromClaims({ sub: "3f1c2a9e-5b7d-4e21-9c0a-8d6f4b2e1a07", email: "reader@example.com" })).toEqual({ id: "3f1c2a9e-5b7d-4e21-9c0a-8d6f4b2e1a07", email: "reader@example.com" });
    expect(readReaderFromClaims({ email: "reader@example.com" })).toBeNull();
    expect(readReaderFromClaims(null)).toBeNull();
  });
});
