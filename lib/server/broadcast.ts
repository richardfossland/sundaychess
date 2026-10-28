import "server-only";

// Server-side Supabase Realtime broadcast via the REST endpoint — lets a
// stateless Route Handler push an event to a channel without opening a
// websocket. Clients subscribed to `topic` receive it.
//
// Failures are swallowed (logged): realtime is a hint layer; if a broadcast is
// lost, clients still recover by refetching authoritative state on their next
// action or reconnect.
//
// Hard timeout: nearly every caller `await`s this right before responding to
// the player (e.g. /api/move, /api/join) — a hung fetch to the Realtime
// endpoint would freeze that response and stall gameplay. Bound it with an
// AbortController, same shape as lib/server/llm.ts's narrateReview, so a
// stalled request aborts instead of hanging forever. Timeout is a fetch
// failure like any other here: log and move on, never throw.
const BROADCAST_TIMEOUT_MS = 5000;

/** TRANSITION (one release cycle, then delete): also send a PUBLIC copy so tabs
 * still running the previous bundle (public channels) keep getting live hints
 * until they reload. Public and private channels on one topic are separate, so
 * the copy never reaches the new private subscribers twice. Messages are
 * `private: true` otherwise (migration 0014); service_role bypasses Realtime
 * RLS, so the server may send anywhere. */
export const LEGACY_PUBLIC_COPY = true;

/** The REST `messages` body for one broadcast. */
export function broadcastMessages(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
  legacy: boolean = LEGACY_PUBLIC_COPY,
): Array<{ topic: string; event: string; payload: Record<string, unknown>; private: boolean }> {
  const msgs = [{ topic, event, payload, private: true }];
  if (legacy) msgs.push({ topic, event, payload, private: false });
  return msgs;
}

export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown> = {},
  timeoutMs = BROADCAST_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: broadcastMessages(topic, event, payload),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn("[broadcast] failed", topic, event, res.status);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      console.warn("[broadcast] timeout", topic, event, timeoutMs);
    } else {
      console.warn("[broadcast] error", topic, event, err);
    }
  } finally {
    clearTimeout(t);
  }
}
