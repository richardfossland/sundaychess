"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import { dismissReminder, completedRounds, isIos, shouldRemindExport } from "@/lib/physical/exportReminder";
import { canUndo } from "@/lib/physical/reducer";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { NavLink } from "./nav";
import { FileMenu } from "./FileMenu";
import { ContinueDigital } from "./ContinueDigital";
import { loadDigitalMeta, type DigitalMeta } from "@/lib/physical/digitalMeta";
import { CloudMenu } from "./cloud/CloudMenu";
import { PrintMenu } from "./print/PrintMenu";
import { PlayersPanel } from "./PlayersPanel";
import { RoundPanel } from "./RoundPanel";
import { BracketPanel, CrosstablePanel, StandingsPanel } from "./StandingsPanel";
import { usePhysicalTournament } from "./usePhysical";
import "./physical.css";

type Tab = "round" | "standings" | "crosstable" | "bracket" | "players";

/** Dismissable «eksporter turneringsfila»-påminnelse (sterkere på iOS uten vedvarende lagring). */
function ExportReminder({ t }: { t: PhysicalTournament }) {
  const L = no.physicalCloud;
  const [hidden, setHidden] = useState(false);
  const [weak, setWeak] = useState(false);
  const done = completedRounds(t);
  useEffect(() => {
    if (!isIos()) return;
    // Bare spørring (ikke persist(): den kan vise en tillatelsesdialog hver gang).
    void Promise.resolve(navigator.storage?.persisted?.())
      .then((persisted) => setWeak(!persisted))
      .catch(() => setWeak(true));
  }, []);
  if (hidden || !shouldRemindExport(t)) return null;
  return (
    <div className={`banner ${weak ? "banner-error" : ""} spread gap-3`} role="status" data-testid="export-reminder">
      <span>{weak ? L.exportReminderIos : L.exportReminder(done)}</span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => { dismissReminder(t); setHidden(true); }}>{L.exportReminderDismiss}</button>
    </div>
  );
}

export function PhysicalBoard({ id }: { id: string }) {
  const { state: t, status, error, setError, apply, run, undo, readOnly, takeOver, storeKind, saveState, toast, dismissToast } = usePhysicalTournament(id);
  const [tab, setTab] = useState<Tab>("round");
  const [digital, setDigital] = useState<DigitalMeta | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDigital(loadDigitalMeta(id));
  }, [id]);
  const p = no.physical;

  // Angre med Ctrl/⌘+Z (ikke mens man skriver i et felt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (digital) return;
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, digital]);

  // Toast forsvinner av seg selv.
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(dismissToast, 9000);
    return () => clearTimeout(h);
  }, [toast, dismissToast]);

  if (status === "loading") return <main className="center-screen"><span className="spin" /></main>;
  if (status !== "ready" || !t) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack">
          <div className="banner banner-error">{status === "corrupt" ? p.loadFailed : p.notFound}</div>
          <NavLink href="/arranger/fysisk" className="btn btn-block">{p.backToList}</NavLink>
        </div>
      </main>
    );
  }

  const knockout = t.settings.system === "knockout";
  const tabs: { key: Tab; label: string }[] = [
    { key: "round", label: p.tabs.round },
    { key: "standings", label: p.tabs.standings },
    knockout ? { key: "bracket", label: p.tabs.bracket } : { key: "crosstable", label: p.tabs.crosstable },
    { key: "players", label: p.tabs.players },
  ];
  const active: Tab = tabs.some((x) => x.key === tab) ? tab : "round";
  const saveLabel = saveState === "saving" ? p.saveSaving : saveState === "failed" ? p.saveFailedShort : p.saveSaved;

  return (
    <main className="center-screen center-top">
      <div className="card stack scale-in pr-wrap">
        <div className="pr-top">
          <div className="pr-title">
            <p className="eyebrow">{p.entryTitle} · {p.systems[t.settings.system].label}</p>
            <h1 className="pr-h1">{t.title}</h1>
            {t.status === "finished" && <span className="badge badge-done">{p.finishedNote}</span>}
          </div>
          <div className="pr-header-actions" aria-label={p.actionsSlotLabel}>
            <span className="pr-save" role="status" aria-live="polite" data-state={saveState} data-testid="save-state">{saveLabel}</span>
            <PrintMenu id={t.id} />
            <FileMenu t={t} />
            {/* En skrivebeskyttet fane har kanskje utdatert logg og skal aldri pushe til skyen. */}
            {!readOnly && !digital && <CloudMenu t={t} run={run} />}
            {!readOnly && !digital && t.status !== "finished" && <ContinueDigital t={t} />}
            <button type="button" className="btn btn-sm btn-ghost" onClick={undo} disabled={!canUndo(t) || !!digital}>
              <Icon name="undo" size={14} /> {p.undo}
            </button>
            <NavLink href="/arranger/fysisk" className="btn btn-sm btn-ghost">{p.backToList}</NavLink>
          </div>
        </div>

        {readOnly && (
          <div className="banner banner-error stack gap-2" role="alert" data-testid="readonly-banner">
            <b>{no.physicalCloud.lockedTitle}</b>
            <span className="fs-xs">{no.physicalCloud.lockedBody}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { if (window.confirm(no.physicalCloud.lockTakeOverConfirm)) void takeOver(); }}
            >
              {no.physicalCloud.lockTakeOver}
            </button>
          </div>
        )}
        {digital && (
          <div className="banner stack gap-2" role="status" data-testid="continued-digital-banner">
            <b>{no.continueDigital.continuedBanner}</b>
            <a className="btn btn-sm" href={`/host/${digital.digitalId}`}>
              {no.continueDigital.continuedLink} ({no.continueDigital.continuedPin(digital.joinPin)})
            </a>
          </div>
        )}
        <ExportReminder t={t} />
        {storeKind === "memory" && <div className="banner banner-error">{p.storageMemoryWarn}</div>}
        {saveState === "failed" && <div className="banner banner-error">{p.saveFailed}</div>}
        {error && <div className="banner banner-error" role="alert" onClick={() => setError(null)}>{error}</div>}

        <div className="pr-tabs" role="tablist" aria-label={p.tabsLabel}>
          {tabs.map((x) => (
            <button key={x.key} type="button" role="tab" id={`tab-${x.key}`} aria-selected={active === x.key} aria-controls="tab-panel" className="pr-tab" onClick={() => setTab(x.key)}>
              {x.label}
            </button>
          ))}
        </div>

        <fieldset disabled={readOnly || !!digital} className="pr-fieldset">
        <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="stack">
          {active === "round" && <RoundPanel t={t} apply={apply} run={run} />}
          {active === "standings" && <StandingsPanel t={t} />}
          {active === "crosstable" && <CrosstablePanel t={t} />}
          {active === "bracket" && <BracketPanel t={t} />}
          {active === "players" && <PlayersPanel t={t} apply={apply} />}
        </div>
        </fieldset>
      </div>

      {toast && (
        <div className="pr-toast" role="status" aria-live="polite" key={toast.id}>
          <span>{toast.text}</span>
          {toast.undoable && canUndo(t) && (
            <button type="button" className="btn btn-sm" onClick={() => { undo(); }}>
              <Icon name="undo" size={14} /> {p.toastUndo}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" aria-label={p.toastClose} onClick={dismissToast}><Icon name="close" size={14} /></button>
        </div>
      )}
    </main>
  );
}
