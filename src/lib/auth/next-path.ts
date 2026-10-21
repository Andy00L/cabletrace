// Where a reader goes after signing in: back to the page that sent them to sign in (the `next` query value), on this
// site only, or to the console when there is no page to go back to.

export const AFTER_SIGN_IN_PATH = "/cases/eagle-s-2024";
// A base no real site can have (.invalid is reserved by RFC 2606): a `next` that parses to another origin is refused.
const PATH_BASE = "https://cabletrace.invalid";
// A replay deep link with its moment and view is about 120 characters; anything far longer is not a link of this site.
const MAX_NEXT_LENGTH = 2_048;

function isAccountPath(pathname: string): boolean {
  return pathname === "/sign-in" || pathname === "/sign-up";
}

/** The path a `next` value names, normalised as the browser will read it; the console for anything off this site. */
export function readSafeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_NEXT_LENGTH || !value.startsWith("/")) return AFTER_SIGN_IN_PATH;
  // The URL parser settles every trick ("//host", "/\host", tabs inside "/\t/host") exactly as the browser would.
  let parsed: URL;
  try {
    parsed = new URL(value, PATH_BASE);
  } catch {
    return AFTER_SIGN_IN_PATH;
  }
  if (parsed.origin !== PATH_BASE || isAccountPath(parsed.pathname)) return AFTER_SIGN_IN_PATH;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// Next re-serialises a request's query before the proxy sees it (it drops its own internal parameters), which
// escapes ":", "," and "/". All three are legal in a query and read back the same, so a deep link keeps the form the
// reader typed ("t=2024-12-25T16:44Z", not "t=2024-12-25T16%3A44Z").
// sourceRef: node_modules/next/dist/server/web/adapter.js (stripInternalSearchParams).
const READABLE_QUERY_ESCAPES: readonly [string, string][] = [
  ["%3A", ":"],
  ["%2C", ","],
  ["%2F", "/"],
];

/** A query string with the escapes Next added undone, where the plain character means the same. */
export function restoreReadableQuery(search: string): string {
  return READABLE_QUERY_ESCAPES.reduce((query, [escape, character]) => query.replaceAll(escape, character), search);
}

/** The sign-in page that sends the reader on to `nextPath` afterwards. */
export function buildSignInPath(nextPath: string): string {
  return `/sign-in?next=${encodeURIComponent(nextPath)}`;
}
