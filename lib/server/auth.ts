import "server-only";

import { createAuthClient } from "@/lib/supabase/auth-server";
import { getPlayer, getTournament } from "@/lib/server/store";
import { normalizeResumeCode } from "@/lib/codes";
import type { Player, Tournament } from "@/lib/types";

/** Authenticate a student by their (playerId, resumeCode) bearer pair.
 * Returns the player on success, null otherwise. */
export async function authPlayer(
  playerId: unknown,
  resumeCode: unknown,
): Promise<Player | null> {
  if (typeof playerId !== "string" || typeof resumeCode !== "string") return null;
  const player = await getPlayer(playerId);
  if (!player) return null;
  if (player.resume_code !== normalizeResumeCode(resumeCode)) return null;
  return player;
}

/** Authenticate the teacher for a tournament by its host code. */
export async function authHost(
  tournamentId: unknown,
  hostCode: unknown,
): Promise<Tournament | null> {
  if (typeof tournamentId !== "string" || typeof hostCode !== "string") return null;
  const t = await getTournament(tournamentId);
  if (!t) return null;
  if (t.host_code !== normalizeResumeCode(hostCode)) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Sunday Account host login (NEW — additive). This sits ALONGSIDE the code-based
// host/player auth above; none of the existing anonymous flows depend on it.
//
// Authorization is isolated here in ONE place: a signed-in Sunday Account user
// is only treated as an admin/arrangør if their email is on CHESS_ADMIN_EMAILS.
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

/** The Sunday Account user signed into the host surface. */
export interface HostUser {
  id: string;
  email: string;
}

/** Parse the CHESS_ADMIN_EMAILS allow-list (comma/whitespace separated). */
function adminEmails(): string[] {
  return (process.env.CHESS_ADMIN_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Is this email allowed to act as a host/arrangør? The ONLY authz decision —
 * keep it here so there's a single place to audit who can manage tournaments. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmails();
  // Empty allow-list = no Sunday Account host is authorized (fail closed). The
  // code-based host flow is unaffected; this only gates the new dashboard.
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

/** Resolve the signed-in Sunday Account host from the shared `sb-*` cookie and
 * authorize them against the admin allow-list. Throws AuthError(401) when there
 * is no session, AuthError(403) when the email is not allow-listed. Used by the
 * host dashboard + owner-gated host API routes. */
export async function requireHost(): Promise<HostUser> {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AuthError(401, "not_signed_in");
  const email = user.email ?? null;
  if (!isAdminEmail(email)) throw new AuthError(403, "not_authorized");
  return { id: user.id, email: email! };
}

/** Like requireHost but returns null instead of throwing — for Server
 * Components that want to render a sign-in prompt rather than a redirect. */
export async function getHost(): Promise<HostUser | null> {
  try {
    return await requireHost();
  } catch {
    return null;
  }
}

/** Uniform AuthError → Response for API routes (mirrors the sister apps). */
export function authFail(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
