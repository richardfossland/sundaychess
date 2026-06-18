import { NextResponse } from "next/server";

import { createAuthClient } from "@/lib/supabase/auth-server";

// OAuth/magic-link landing: exchange the code for the shared Sunday Account
// session cookie, then send the host to the dashboard. Whitelisted in the
// middleware (no session exists yet at this point).
//
// Hardened: only same-origin relative `next` targets are honoured (defends
// against an open-redirect via a crafted `?next=https://evil`), and any failure
// to exchange the code falls back to the login screen with an error flag rather
// than a blank/500.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only relative, single-leading-slash paths are accepted (no `//host`, no
  // absolute URLs) so the post-login redirect can never leave this origin.
  const requested = searchParams.get("next") ?? "/host";
  const next =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : "/host";

  if (!code) {
    return NextResponse.redirect(`${origin}/host/login?error=missing_code`);
  }

  const supabase = await createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/host/login?error=auth`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
