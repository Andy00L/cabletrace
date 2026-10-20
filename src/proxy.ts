import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// The whole app sits behind sign-in (Andy, 17 Oct 2026). Public: the landing page, the sign-in and sign-up pages,
// and /api/health for monitoring. Static files (the art, seabed grids, textures) are open data and never reach this
// proxy (config.matcher).
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/api/health"]);
const isApiRoute = createRouteMatcher(["/api/(.*)"]);

export default clerkMiddleware(
  async (auth, request) => {
    if (isPublicRoute(request)) return;
    // A data API answers 401 instead of Clerk's default 404, so a caller can tell "sign in" from "no such route".
    if (isApiRoute(request)) {
      const { userId } = await auth();
      if (!userId) return NextResponse.json({ error: "Sign in to read this." }, { status: 401 });
      return;
    }
    // A page sends a signed-out reader to sign in and back to the exact link afterwards (redirect_url, same origin
    // only: src/components/account/ClerkAppProvider.tsx).
    await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  // Every page and API; never Next's own files or a request for a static file (by extension), which skips the proxy.
  // sourceRef: Clerk's recommended matcher for Next.js, with the file types this app serves from public/ added
  // (avif, bin, json, mp4, txt).
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|json|jpe?g|webp|avif|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|bin|mp4|txt)).*)", "/(api|trpc)(.*)"],
};
