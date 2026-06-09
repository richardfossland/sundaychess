import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never
 * be imported into client code (the `server-only` guard enforces this at build
 * time). Every state-changing API route uses this. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
