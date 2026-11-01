"use client";

import { useState } from "react";

import { no } from "@/lib/locale/no";
import { createAuthBrowserClient } from "@/lib/supabase/auth-browser";
import { PageHeader } from "@/lib/client/PageHeader";

// Sunday Account host login. Magic-link + OAuth ("Logg inn med Sunday-konto" /
// Google) go through the AUTH (issuer) project; on success the shared `sb-*`
// cookie is set and the callback lands the host on /host. This screen is for the
// ARRANGØR only — players/joiners never see it (they use codes).
export default function HostLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/callback`
      : undefined;

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createAuthBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setError(no.hostAuth.linkError);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    const supabase = createAuthBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack scale-in">
        <PageHeader backHref="/arranger" />

        <div className="card-head">
          <p className="eyebrow">{no.hostAuth.loginTitle}</p>
          <p className="muted fs-sm">{no.hostAuth.loginLede}</p>
        </div>

        {sent ? (
          <div className="banner banner-ok">{no.hostAuth.linkSent}</div>
        ) : (
          <form onSubmit={sendMagicLink} className="stack gap-3">
            <div className="field">
              <label htmlFor="email">{no.hostAuth.emailLabel}</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={no.hostAuth.emailPlaceholder}
                autoComplete="email"
              />
            </div>
            {error && <div className="banner banner-error">{error}</div>}
            <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
              {busy ? no.hostAuth.sending : no.hostAuth.sendLink}
            </button>
          </form>
        )}

        <div className="text-center muted fs-xs">
          {no.hostAuth.or}
        </div>

        <button className="btn btn-block btn-lg" onClick={signInWithGoogle}>
          {no.hostAuth.google}
        </button>
      </div>
    </main>
  );
}
