"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { report } from "@/lib/client/telemetry";
import { no } from "@/lib/locale/no";
import { PageHeader } from "@/lib/client/PageHeader";

// Route-level error boundary — a transient render/runtime error shows a
// friendly recovery screen instead of a blank, unrecoverable page.
//
// React error boundaries (this file) bypass the window.onerror /
// unhandledrejection hooks installed in instrumentation-client.ts — those only
// see errors that escape React's own catch. So the loudest client failure of
// all (a render crash) would otherwise never reach telemetry. Report it here,
// once, on mount.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    report("js_error", {
      boundary: "error",
      message: String(error?.message ?? "").slice(0, 200),
      digest: error?.digest,
    });
    // Mount-only: this boundary renders once per error, and we want exactly
    // one report per occurrence, not one per re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center align-center">
        <PageHeader />
        <div className="status-glyph">♟️</div>
        <h2 className="fs-xl">{no.common.error}</h2>
        <p className="muted status-copy">{no.common.errorRetryBody}</p>
        <Link href="/personvern" className="text-link-inline fs-xs">
          {no.privacy.link}
        </Link>
        <div className="row status-actions">
          <button className="btn btn-primary btn-lg" onClick={() => reset()}>
            {no.common.retry}
          </button>
          <button
            className="btn btn-lg"
            onClick={() => {
              // Redirect ONLY — never identity.clearPlayer(): a render crash is
              // not evidence the session is invalid, and /play resumes it.
              router.push("/play");
            }}
          >
            {no.common.toLogin}
          </button>
        </div>
      </div>
    </main>
  );
}
