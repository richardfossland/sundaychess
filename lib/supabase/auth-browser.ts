"use client";

import { createBrowserClient } from "@supabase/ssr";

import { sharedCookieOptions } from "./cookies";

/**
 * Browser client for the Sunday Account AUTH (issuer) project — NOT the app's
 * data project. Used ONLY on the host login screen to start a magic-link / OAuth
 * sign-in. It points at NEXT_PUBLIC_SUNDAY_AUTH_URL / _ANON_KEY (the issuer), and
 * writes the shared `sb-*` cookie scoped to `.sundaysuite.app` in production.
 *
 * Keep this separate from `lib/supabase/client.ts` (the data/anon Realtime
 * client): that one stays session-less so they don't fight over cookies.
 */
export function createAuthBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL!,
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY!,
    { cookieOptions: sharedCookieOptions() },
  );
}
