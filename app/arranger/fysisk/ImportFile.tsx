"use client";

import { useId, useRef, useState } from "react";
import { Modal } from "@/lib/client/Modal";
import { no } from "@/lib/locale/no";
import { classifyConflict, saveImported, type Conflict, type Resolution } from "@/lib/import/apply";
import { parseTournamentFile, type ParsedFile } from "@/lib/import/parse";
import { navigate } from "./nav";
import { getStore } from "./usePhysical";

interface Pending {
  parsed: ParsedFile;
  conflict: Conflict;
}

/** «Åpne turneringsfil»: velg fil → valider → (konflikt?) → lagre lokalt → åpne. Alt offline. */
export function ImportFile() {
  const f = no.physical.file;
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setConfirmed(false);
    setBusy(true);
    try {
      const res = await parseTournamentFile(await file.text());
      if (!res.ok) return setError(res.error);
      const store = await getStore();
      let local = null;
      try {
        local = await store.get(res.tournament.id);
      } catch {
        local = null;
      }
      setPending({ parsed: res, conflict: classifyConflict(local ? local.events : null, res.tournament.events) });
    } catch {
      setError(f.errors.notJson);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function commit(resolution: Resolution) {
    if (!pending) return;
    setBusy(true);
    try {
      const id = await saveImported(await getStore(), pending.parsed.tournament, resolution);
      setPending(null);
      navigate(`/arranger/fysisk/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : f.saveFailed);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const p = pending?.parsed;
  const c = pending?.conflict;
  const blocked = !!p?.needsConfirm && !confirmed;

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label={f.openFile}
        data-testid="import-file-input"
        hidden
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <button type="button" className="btn btn-block" disabled={busy} onClick={() => input.current?.click()}>
        {f.openFile}
      </button>
      {error && (
        <div className="banner banner-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {pending && p && c && (
        <Modal open onClose={() => setPending(null)} labelledBy={titleId} size="md">
          <div className="stack">
            <h3 id={titleId} style={{ margin: 0 }}>{f.importTitle}</h3>
            <p>{f.importSummary(p.tournament.title, p.tournament.players.length, p.tournament.rounds.filter((r) => r.status === "completed").length)}</p>
            {!p.hashOk && <div className="banner banner-error" role="alert">{f.tamperedWarn}</div>}
            {p.hashOk && !p.snapshotOk && <div className="banner banner-error" role="alert">{f.snapshotWarn}</div>}
            {p.rematches.map((r) => (
              <div key={`${r.a}|${r.b}`} className="banner">{f.rematchWarn(r.a, r.b, r.rounds.join(", "))}</div>
            ))}
            {p.needsConfirm && (
              <label>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> {f.tamperedConfirm}
              </label>
            )}
            {c.kind !== "none" && (
              <div className="stack" style={{ gap: 6 }}>
                <b>{f.conflictTitle}</b>
                <span>
                  {c.kind === "same" && f.conflictSame}
                  {c.kind === "localNewer" && f.conflictLocalNewer(c.localExtra)}
                  {c.kind === "fileNewer" && f.conflictFileNewer}
                  {c.kind === "diverged" && f.conflictDiverged}
                </span>
              </div>
            )}
            <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>{f.cancel}</button>
              {c.kind === "none" ? (
                <button type="button" className="btn btn-primary" disabled={blocked || busy} onClick={() => commit("replace")}>{f.importButton}</button>
              ) : (
                <>
                  <button type="button" className="btn" disabled={blocked || busy} onClick={() => commit("copy")}>{f.keepBoth}</button>
                  <button type="button" className="btn btn-primary" disabled={blocked || busy} onClick={() => commit("replace")}>{f.replace}</button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
