import type { CookieOptions } from "@supabase/ssr";

/**
 * Shared cookie options for the Sunday Account AUTH client (browser, server,
 * middleware) so the `sb-*` session cookie is written identically everywhere.
 *
 * Cross-subdomain SSO (Sunday Account): when `NEXT_PUBLIC_COOKIE_DOMAIN` is set
 * (`.sundaysuite.app` in production), the session cookie is scoped to the parent
 * domain so every Sunday web app shares ONE login. Left unset in local dev so
 * cookies keep working on `localhost`.
 *
 * NOTE: only the AUTH client (issuer project) sets a session cookie. The app's
 * DATA/anon client (`lib/supabase/client.ts`) is deliberately session-less, so
 * the two never fight over cookies.
 */
export function sharedCookieOptions(): CookieOptions {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  if (!domain) return {};
  return {
    domain,
    path: "/",
    sameSite: "lax",
    secure: true,
  };
}
