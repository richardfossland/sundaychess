"use client";

import { useEffect, useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { replay } from "@/lib/physical/reducer";
import { publicUrl } from "@/lib/physical/cloudMeta";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { getCloud, useCloudState } from "./cloudRegistry";

const L = no.physicalCloud;

export function cloudErrorText(code: string): string {
  return (L.errors as Record<string, string>)[code] ?? L.errors.server_error;
}

/**
 * «Sky»-meny i turneringshodet: publiser, kopier offentlig lenke, vis arrangørkode,
 * avpubliser, og konfliktløsning. Holder også synken i gang (push etter hver endring).
 * `run` er usePhysicalTournament().run (brukes til «last skyversjonen»).
 */
export function CloudMenu({ t, run }: { t: PhysicalTournament; run: (fn: (cur: PhysicalTournament) => PhysicalTournament) => void }) {
  const cloud = getCloud(t.id);
  const st = useCloudState(t.id);
  const [open, setOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const published = st.status !== "unpublished";
  // En konflikt må løses, så panelet står åpent til den er løst.
  const panelOpen = open || st.status === "conflict";

  // Ved oppstart: push ev. endringer gjort offline før omlasting. Senere endringer pushes av
  // lagringskøen etter vellykket lokal lagring (cloudSaved i usePhysical).
  const eventsRef = useRef(t.events);
  eventsRef.current = t.events;
  useEffect(() => {
    cloud.notifyLocalChange(eventsRef.current);
  }, [cloud]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function publish() {
    setBusy(true);
    setMsg(null);
    const r = await cloud.publish(t.events);
    setBusy(false);
    if (!r.ok) setMsg(cloudErrorText(r.code));
  }
  async function unpublish() {
    if (!window.confirm(L.unpublishConfirm)) return;
    setBusy(true);
    const r = await cloud.unpublish();
    setBusy(false);
    setMsg(r.ok ? null : cloudErrorText(r.code ?? "server_error"));
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl(t.id));
      setMsg(L.linkCopied);
    } catch {
      window.prompt(L.copyLink, publicUrl(t.id));
    }
  }
  async function loadCloud() {
    if (!window.confirm(L.loadCloudConfirm)) return;
    setBusy(true);
    const got = await cloud.fetchCloudLog();
    setBusy(false);
    if (!got) return setMsg(cloudErrorText("offline"));
    try {
      const next = replay(got.events);
      run(() => next);
      cloud.markSynced(next.events, got.version);
      setMsg(null);
    } catch {
      setMsg(cloudErrorText("invalid_log"));
    }
  }
  async function overwrite() {
    if (!window.confirm(L.overwriteConfirm)) return;
    setBusy(true);
    await cloud.overwriteCloud();
    setBusy(false);
  }

  const meta = cloud.meta();
  const dot = st.status === "synced" ? "var(--ok, #2a9d5c)" : st.status === "conflict" || st.status === "error" ? "var(--danger, #d64545)" : st.status === "unpublished" ? "var(--ink-soft, #999)" : "var(--warn, #d9a21b)";

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }} data-testid="cloud-menu">
      <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="menu" aria-expanded={panelOpen} aria-label={L.menuAria} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: dot, marginRight: 6 }} />
        {L.menu}: <span data-testid="cloud-status">{L.status[st.status]}</span>
      </button>
      {panelOpen && (
        <div className="card stack" style={{ position: "absolute", right: 0, top: "100%", zIndex: 30, width: "min(92vw, 340px)", gap: 8, padding: 12 }}>
          {!published && (
            <>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>{L.publishIntro}</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                {busy ? L.publishing : L.publish}
              </button>
            </>
          )}
          {published && (
            <>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>{L.publishedNote}</p>
              {st.status === "conflict" && (
                <div className="banner banner-error stack" role="alert" style={{ gap: 6 }}>
                  <b>{L.conflictTitle}</b>
                  <span style={{ fontSize: 13 }}>{L.conflictBody}</span>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={loadCloud}>{L.loadCloud}</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={overwrite}>{L.overwriteCloud}</button>
                </div>
              )}
              {st.status === "error" && <div className="banner banner-error" role="alert">{cloudErrorText(st.errorCode ?? "server_error")}</div>}
              {(st.status === "offline" || st.status === "pending") && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => cloud.retryNow()}>{L.retry}</button>
              )}
              <a className="btn btn-sm btn-ghost" href={publicUrl(t.id)} target="_blank" rel="noreferrer">{L.openPublic}</a>
              <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>{L.copyLink}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowCode((s) => !s)}>
                {showCode ? L.hideCode : L.showCode}
              </button>
              {showCode && meta && (
                <div className="stack" style={{ gap: 2 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{L.codeLabel}</span>
                  <b data-testid="cloud-host-code" style={{ fontSize: 22, letterSpacing: 2 }}>{meta.hostCode}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{L.codeHelp}</span>
                </div>
              )}
              <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={unpublish}>{L.unpublish}</button>
            </>
          )}
          {msg && <span role="status" className="muted" style={{ fontSize: 12 }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

