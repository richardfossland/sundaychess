import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { sharedCookieOptions } from "./cookies";

/**
 * Server client bound to the request cookies, pointed at the Sunday Account AUTH
 * (issuer) project — used ONLY to resolve the signed-in HOST user from the
 * shared `sb-*` cookie, and to exchange a magic-link/OAuth code in the callback.
 * Authorization (who is an admin) is a separate, explicit allow-list check in
 * `lib/server/auth.ts`.
 *
 * This never touches the app's data project; all tournament reads/writes stay on
 * the service-role data client.
 */
export async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL!,
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY!,
    {
      cookieOptions: sharedCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In Server Components cookie writes throw; the middleware refreshes
          // the session, so swallowing here is safe.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // no-op in RSC render context
          }
        },
      },
    },
  );
}
