import { swSource } from "@/lib/sw/source";

// Service worker, stamped with the build id (see lib/sw/source.ts). Dynamic on
// purpose: a prerendered route would get Next's long s-maxage, and the worker
// script must ALWAYS revalidate or a stale one pins users to an old app.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(swSource(process.env.NEXT_PUBLIC_BUILD_ID), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
