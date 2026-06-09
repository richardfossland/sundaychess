import "server-only";

import { getPlayer } from "@/lib/server/store";
import { normalizeResumeCode } from "@/lib/codes";
import type { Player } from "@/lib/types";

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
