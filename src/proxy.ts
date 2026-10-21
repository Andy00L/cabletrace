import { NextResponse, type NextRequest } from "next/server";
import { buildSignInPath, readSafeNextPath, restoreReadableQuery } from "@/lib/auth/next-path";
import { carrySessionCookies, readProxySession } from "@/lib/auth/proxy-session";

// The whole app sits behind sign-in (Andy, 17 Oct 2026). Public: the landing page and /api/health for monitoring, plus
// the sign-in and sign-up pages. Static files (the art, seabed grids, textures) are open data and never reach this
// proxy (config.matcher).
const OPEN_PATHS = new Set(["/", "/api/health"]);
const ACCOUNT_PATHS = new Set(["/sign-in", "/sign-up"]);

/**
 * A navigation the browser shows (a document or a frame). Anything else answers 404 signed out, as before the switch
 * from Clerk (testsprite/backend/sign_in_gate.py): a download, a script's fetch, and the router's fetch of a page's
 * server payload, whose headers Next strips before the proxy runs (node_modules/next/dist/server/web/adapter.js,
 * FLIGHT_HEADERS). On that 404 the router loads the whole page instead, a document request this proxy redirects.
 */
function isPageRequest(request: NextRequest): boolean {
  const destination = request.headers.get("sec-fetch-dest");
  if (destination === "document" || destination === "iframe") return true;
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();
  const session = await readProxySession(request);
  if (ACCOUNT_PATHS.has(pathname)) {
    // A signed-in reader has nothing to do on the form: on to where they were going.
    if (session.readerId === null || request.method !== "GET") return session.response;
    const nextPath = readSafeNextPath(request.nextUrl.searchParams.get("next"));
    return carrySessionCookies(session, NextResponse.redirect(new URL(nextPath, request.url)));
  }
  if (session.readerId !== null) return session.response;
  // A data API answers 401, so a caller can tell "sign in" from "no such route".
  if (pathname.startsWith("/api/")) return carrySessionCookies(session, NextResponse.json({ error: "Sign in to read this." }, { status: 401 }));
  // A page sends a signed-out reader to sign in and back to the exact link afterwards (same origin only).
  const returnPath = `${pathname}${restoreReadableQuery(request.nextUrl.search)}`;
  if (isPageRequest(request)) return carrySessionCookies(session, NextResponse.redirect(new URL(buildSignInPath(returnPath), request.url)));
  return carrySessionCookies(session, new NextResponse(null, { status: 404 }));
}

export const config = {
  // Every page and API; never Next's own files or a request for a static file (by extension), which skips the proxy.
  // The file types are the ones this app serves from public/.
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|json|jpe?g|webp|avif|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|bin|mp4|txt)).*)", "/(api|trpc)(.*)"],
};
