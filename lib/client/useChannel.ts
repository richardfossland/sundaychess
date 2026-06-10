"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Handler = (event: string, payload: Record<string, unknown>) => void;

/** Subscribe to a Supabase Realtime channel and invoke `onEvent` for every
 * broadcast event on it. Resubscribes when the topic changes. The handler is
 * kept in a ref so consumers don't need to memoise it.
 *
 * Returns a stable `send(event, payload)` for ephemeral client broadcasts
 * (e.g. emoji reactions) on the same channel — a no-op until subscribed. */
export function useChannel(
  topic: string | null,
  onEvent: Handler,
): (event: string, payload: Record<string, unknown>) => void {
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!topic) return;
    // Guard against missing env in local/dev so the UI still renders.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();
    const channel = supabase.channel(topic, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "*" }, (msg) => {
      handlerRef.current(
        (msg.event as string) ?? "",
        (msg.payload as Record<string, unknown>) ?? {},
      );
    });
    channel.subscribe();
    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [topic]);

  return useCallback((event: string, payload: Record<string, unknown>) => {
    void channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);
}
