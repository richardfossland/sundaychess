"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon key). Used ONLY for Realtime broadcast +
 * presence subscriptions. All authoritative reads/writes go through the
 * server API routes (RLS denies direct table access to anon — see §8). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
