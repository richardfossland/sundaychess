"use client";

import Link from "next/link";
import { useState } from "react";

import { no } from "@/lib/locale/no";
import { createAuthBrowserClient } from "@/lib/supabase/auth-browser";

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
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>

        <p className="eyebrow text-center">{no.hostAuth.loginTitle}</p>
        <p className="muted text-center" style={{ fontSize: 14 }}>
          {no.hostAuth.loginLede}
        </p>

        {sent ? (
          <div className="banner banner-ok">{no.hostAuth.linkSent}</div>
        ) : (
          <form onSubmit={sendMagicLink} className="stack" style={{ gap: 12 }}>
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

        <div className="text-center muted" style={{ fontSize: 12, margin: "4px 0" }}>
          {no.hostAuth.or}
        </div>

        <button className="btn btn-block btn-lg" onClick={signInWithGoogle}>
          {no.hostAuth.sunday}
        </button>

        <Link href="/arranger" className="btn btn-ghost btn-block">
          ← {no.common.back}
        </Link>
      </div>
    </main>
  );
}
