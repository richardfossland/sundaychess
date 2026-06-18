import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sharedCookieOptions } from "./cookies";

/** The host login page itself — reachable WITHOUT a Sunday Account session. */
const HOST_LOGIN = "/host/login";

/** OAuth/magic-link landing: exchanges the code BEFORE any session cookie
 * exists, so it must never be gated. */
const AUTH_CALLBACK = "/auth/callback";

/**
 * Refresh the Sunday Account session cookie and gate ONLY the host/arrangør
 * surface (`/host/*`). Everything else — anonymous join/play/board/projector,
 * the player flows, the public landing, the API — is left completely untouched
 * (this function is only invoked for the matched paths in `middleware.ts`).
 *
 * Players and joiners keep using the existing code-based auth; this gate is for
 * the host dashboard only.
 */
export async function updateHostSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const path = request.nextUrl.pathname;

  // The callback runs before a session exists — never redirect it.
  if (path.startsWith(AUTH_CALLBACK)) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL!,
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY!,
    {
      cookieOptions: sharedCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = path === HOST_LOGIN || path.startsWith(`${HOST_LOGIN}/`);

  // No session → send to the host login (unless already there).
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = HOST_LOGIN;
    return NextResponse.redirect(url);
  }
  // Already signed in and sitting on the login → bounce to the dashboard.
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/host";
    return NextResponse.redirect(url);
  }

  return response;
}
