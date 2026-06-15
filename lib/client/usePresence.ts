"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Track and/or observe Supabase Realtime presence on `topic`.
 *
 * - Pass `trackKey` (a player id) to advertise this client as online under that
 *   key — students do this so the host knows they're connected.
 * - The host passes no `trackKey` and just reads the returned set of online keys.
 *
 * Returns the set of presence keys currently online (recomputed on every
 * sync/join/leave). Shares the one memoised browser client / socket. */
export function usePresence(topic: string | null, trackKey?: string): Set<string> {
  const [present, setPresent] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!topic) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();
    const channel = supabase.channel(topic, {
      config: { presence: { key: trackKey ?? "" } },
    });

    const sync = () => {
      const state = channel.presenceState();
      // Drop the empty observer key (host) — only real player ids count.
      setPresent(new Set(Object.keys(state).filter((k) => k !== "")));
    };
    channel.on("presence", { event: "sync" }, sync);
    channel.on("presence", { event: "join" }, sync);
    channel.on("presence", { event: "leave" }, sync);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" && trackKey) {
        void channel.track({ online: true });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
    // trackKey in deps: a key change re-subscribes (so it's never silently
    // ignored). In practice the player id is stable, so no churn.
  }, [topic, trackKey]);

  return present;
}
