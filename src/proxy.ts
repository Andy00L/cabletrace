import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Clerk runs only where a reader's session matters: the sign-in and sign-up pages, the watchlist page and its API
// (config.matcher). Every other page stays static and never passes through this proxy.
const isWatchlistPage = createRouteMatcher(["/watchlist(.*)"]);

export default clerkMiddleware(
  async (auth, request) => {
    // The page sends a signed-out reader to sign in; the API answers 401 itself.
    if (isWatchlistPage(request)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: ["/watchlist(.*)", "/sign-in(.*)", "/sign-up(.*)", "/api/watchlist(.*)"],
};
