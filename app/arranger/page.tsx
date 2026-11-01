"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";
import { api, ApiError } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { defaultConfig, Wizard } from "./Wizard";
import { Icon } from "@/lib/client/Icon";
import { PageHeader } from "@/lib/client/PageHeader";

/** "Turnering DD.MM" — the auto-title "Rask start" gives a tournament created
 * without visiting the title step. */
function autoTitle(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${no.host.quickStartTitlePrefix} ${dd}.${mm}`;
}

export default function HostEntry() {
  const router = useRouter();
  // Chooser-first: the create/open choice is its own screen, so once you're in
  // the wizard there is no "Åpne turnering" button to accidentally hit (which
  // would reset your progress). A back button returns to the chooser.
  const [mode, setMode] = useState<"choose" | "create" | "open">("choose");
  const [hostCode, setHostCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.openHost(hostCode);
      router.push(`/host/${r.id}`);
    } catch (e) {
      // Both answers mean the same thing to the teacher: that code opens no
      // tournament. `not_found` = a well-formed code nobody owns; `invalid_code`
      // = a code that cannot exist at all (rejected on shape, before the DB), so
      // a plain typo must NOT fall through to the generic "something went wrong".
      setError(
        e instanceof ApiError &&
          (e.code === "not_found" || e.code === "invalid_code")
          ? no.player.invalidCode
          : no.common.error,
      );
      setBusy(false);
    }
  }

  // Creates a tournament immediately with the wizard's defaults (league, 5
  // rounds, no playoff, no round timer, no clock, reactions off, individual,
  // standard) — the same create call the wizard's review step uses, just
  // skipping the 10-11 steps for a host who wants to start right away.
  async function quickStart() {
    setQuickBusy(true);
    setQuickError(null);
    try {
      const t = await api.createTournament(defaultConfig(autoTitle()));
      identity.saveHostCode(t.id, t.hostCode);
      router.push(`/host/${t.id}`);
    } catch {
      setQuickError(no.common.error);
      setQuickBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className={`card ${mode === "create" ? "card-form" : "card-narrow"} stack scale-in`}>
        <PageHeader
          backHref={mode === "choose" ? "/" : undefined}
          onBack={
            mode === "open"
              ? () => {
                  setError(null);
                  setMode("choose");
                }
              : undefined
          }
        />

        {mode === "choose" && (
          <div className="btn-stack">
            <p className="eyebrow text-center">Arrangør</p>
            <button
              className="btn btn-primary choice"
              disabled={quickBusy}
              onClick={quickStart}
            >
              <span className="choice-icon">
                {quickBusy ? <span className="spin" /> : <Icon name="quick" size={24} />}
              </span>
              <span className="choice-text">
                <span className="choice-title">{no.host.quickStart}</span>
                <span className="choice-sub">{no.host.quickStartSub}</span>
              </span>
            </button>
            {quickError && <div className="banner banner-error">{quickError}</div>}
            <button className="btn choice" onClick={() => setMode("create")}>
              <span className="choice-icon"><Icon name="edit" size={24} /></span>
              <span className="choice-text">
                <span className="choice-title">{no.host.customize}</span>
                <span className="choice-sub">{no.host.customizeSub}</span>
              </span>
            </button>
            <button
              className="btn choice"
              onClick={() => {
                setError(null);
                setMode("open");
              }}
            >
              <span className="choice-icon"><Icon name="key" size={24} /></span>
              <span className="choice-text">
                <span className="choice-title">{no.host.enterTitle}</span>
                <span className="choice-sub">{no.host.enterSub}</span>
              </span>
            </button>
            <Link href="/arranger/fysisk" className="btn choice">
              <span className="choice-icon"><Icon name="print" size={24} /></span>
              <span className="choice-text">
                <span className="choice-title">{no.physical.entryTitle}</span>
                <span className="choice-sub">{no.physical.entrySub}</span>
              </span>
            </Link>
          </div>
        )}

        {mode === "create" && <Wizard onExit={() => setMode("choose")} />}

        {mode === "open" && (
          <>
            <p className="eyebrow text-center">{no.host.enterTitle}</p>
            <div className="field">
              <label htmlFor="hc">{no.host.hostCodeLabel}</label>
              <input
                id="hc"
                className="input"
                placeholder="f.eks. ABCD-7F"
                value={hostCode}
                autoFocus
                autoCapitalize="characters"
                onChange={(e) => setHostCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && hostCode.trim() && open()}
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !hostCode.trim()}
              onClick={open}
            >
              {busy ? <span className="spin" /> : no.host.open}
            </button>
            {error && <div className="banner banner-error">{error}</div>}
          </>
        )}
      </div>
    </main>
  );
}
