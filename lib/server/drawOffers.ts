import "server-only";

// In-memory pending draw offers (per process, single-instance deployment).
// gameId → { by: playerId, at: epoch_ms }. Offers expire after 2 minutes.
const offers = new Map<string, { by: string; at: number }>();
const TTL = 2 * 60_000;

export function setOffer(gameId: string, by: string): void {
  offers.set(gameId, { by, at: Date.now() });
}

export function getOffer(gameId: string): string | null {
  const o = offers.get(gameId);
  if (!o) return null;
  if (Date.now() - o.at > TTL) {
    offers.delete(gameId);
    return null;
  }
  return o.by;
}

export function clearOffer(gameId: string): void {
  offers.delete(gameId);
}
