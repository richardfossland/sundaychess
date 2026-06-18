import { type NextRequest } from "next/server";

import { updateHostSession } from "@/lib/supabase/auth-middleware";

// Next "proxy" convention (the renamed-from-middleware request hook — the
// `middleware` filename is deprecated in this Next version).
//
// SCOPE: only the host/arrangør surface and the auth callback. Anonymous play —
// the landing page, /arranger, /play, /solo, /versus, the board/projector at
// /host/[tournamentId], every /api/* route, and all player code-based flows — is
// NOT matched here and runs exactly as before. The host gate refreshes the
// Sunday Account cookie + redirects to /host/login when there is no session.
export async function proxy(request: NextRequest) {
  return updateHostSession(request);
}

export const config = {
  // Gate ONLY the new Sunday Account surface: the `/host` dashboard, its
  // `/host/login` screen, and the `/auth/*` OAuth/magic-link callback.
  //
  // Deliberately NOT `/host/:path*`: the anonymous host BOARD/projector lives at
  // `/host/[tournamentId]` and an arrangør opens it with a host CODE (no Sunday
  // Account). Matching it would break that flow, which the brief requires to stay
  // untouched. So we match the two exact host paths instead of the whole subtree.
  matcher: ["/host", "/host/login", "/auth/:path*"],
};
