"use client";

import { useEffect, useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { InfoTip } from "@/lib/client/InfoTip";
import { replay } from "@/lib/physical/reducer";
import { publicUrl } from "@/lib/physical/cloudMeta";
import { DEFAULT_PUBLIC_NAMES, type PublicNames } from "@/lib/physical/cloudTypes";
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
  const [names, setNames] = useState<PublicNames>(DEFAULT_PUBLIC_NAMES);
  const ref = useRef<HTMLDivElement>(null);
  const published = st.status !== "unpublished";
  // En konflikt må løses, så panelet står åpent til den er løst.
  const panelOpen = open || st.status === "conflict";

  // Ved oppstart: push ev. endringer gjort offline før omlasting. Senere endringer pushes av
  // lagringskøen etter vellykket lokal lagring (cloudSaved i usePhysical).
  const [initialEvents] = useState(t.events);
  useEffect(() => {
    cloud.notifyLocalChange(initialEvents);
  }, [cloud, initialEvents]);

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
    const r = await cloud.publish(t.events, { publicNames: names });
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
  const dotKind = st.status === "synced" ? "ok" : st.status === "conflict" || st.status === "error" ? "bad" : st.status === "unpublished" ? "off" : "warn";

  return (
    <div ref={ref} className="pm-wrap" data-testid="cloud-menu">
      <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="menu" aria-expanded={panelOpen} aria-label={L.menuAria} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="cm-dot" data-kind={dotKind} />
        {L.menu}: <span data-testid="cloud-status">{L.status[st.status]}</span>
      </button>
      {panelOpen && (
        <div className="card stack pm-pop pm-pop-wide">
          {!published && (
            <>
              <div className="tags">
                <span className="tag"><Icon name="live" size={12} /> {L.tagLive}</span>
                <span className="tag"><Icon name="qr" size={12} /> {L.tagQr}</span>
                <span className="tag"><Icon name="offline" size={12} /> {L.tagOffline}</span>
              </div>
              <fieldset className="stack gap-2 cm-fieldset" data-testid="public-names">
                <legend className="cm-legend">{L.namesTitle} <InfoTip align="start">{L.namesHelp}</InfoTip></legend>
                <label className="opt cm-opt">
                  <input type="radio" name="public-names" checked={names === "initials"} onChange={() => setNames("initials")} />
                  <span>{L.namesInitials} <span className="badge badge-live">{no.physical.systemRecommended}</span></span>
                </label>
                <label className="opt cm-opt">
                  <input type="radio" name="public-names" checked={names === "full"} onChange={() => setNames("full")} />
                  <span>{L.namesFull}</span>
                </label>
              </fieldset>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={publish}>
                {busy ? L.publishing : L.publish}
              </button>
            </>
          )}
          {published && (
            <>
              {st.status === "conflict" && (
                <div className="banner banner-error stack gap-2" role="alert">
                  <b>{L.conflictTitle}</b>
                  <span className="fs-xs">{L.conflictBody}</span>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={loadCloud}>{L.loadCloud}</button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={overwrite}>{L.overwriteCloud}</button>
                </div>
              )}
              {st.status === "error" && <div className="banner banner-error" role="alert">{cloudErrorText(st.errorCode ?? "server_error")}</div>}
              {(st.status === "offline" || st.status === "pending") && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => cloud.retryNow()}>{L.retry}</button>
              )}
              <a className="btn btn-sm btn-ghost pm-item" href={publicUrl(t.id)} target="_blank" rel="noreferrer">{L.openPublic}</a>
              <button type="button" className="btn btn-sm btn-ghost pm-item" onClick={copy}>{L.copyLink}</button>
              <button type="button" className="btn btn-sm btn-ghost pm-item" onClick={() => setShowCode((s) => !s)}>
                {showCode ? L.hideCode : L.showCode}
              </button>
              {showCode && meta && (
                <div className="stack gap-1">
                  <span className="muted fs-xs">{L.codeLabel}</span>
                  <b data-testid="cloud-host-code" className="cm-code">{meta.hostCode}</b>
                  <span className="tag tag-warn"><Icon name="lock" size={12} /> {L.codeHelp}</span>
                </div>
              )}
              <button type="button" className="btn btn-sm btn-ghost pm-item" disabled={busy} onClick={unpublish}>{L.unpublish}</button>
            </>
          )}
          {msg && <span role="status" className="muted fs-xs">{msg}</span>}
        </div>
      )}
    </div>
  );
}

