"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type Handler = (event: string, payload: Record<string, unknown>) => void;

/** Subscribe to a Supabase Realtime channel and invoke `onEvent` for every
 * broadcast event on it. Resubscribes when the topic changes. The handler is
 * kept in a ref so consumers don't need to memoise it. */
export function useChannel(topic: string | null, onEvent: Handler) {
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  });

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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [topic]);
}
