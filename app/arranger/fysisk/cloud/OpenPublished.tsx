"use client";

import { useState } from "react";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";
import { fetchTransport } from "@/lib/physical/cloud";
import { saveMeta } from "@/lib/physical/cloudMeta";
import { replay } from "@/lib/physical/reducer";
import type { PhysicalEvent } from "@/lib/physical/schema";
import { loadTournament, saveTournament } from "@/lib/physical/storage";
import { navigate } from "../nav";
import { getStore } from "../usePhysical";
import { cloudErrorText } from "./CloudMenu";

const L = no.physicalCloud;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/** «Åpne publisert turnering» i listen: hent loggen fra skyen med id/lenke + arrangørkode. */
export function OpenPublished() {
  const [id, setId] = useState("");
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const tid = id.match(UUID)?.[0]?.toLowerCase();
    if (!tid) return setErr(L.openBadLink);
    setBusy(true);
    try {
      const res = await fetchTransport("GET", `/api/physical/${tid}/log`, null, { hostCode: code, pairToken: null });
      if (res.status !== 200) {
        setErr(res.status === 401 || res.status === 429 ? cloudErrorText(res.status === 429 ? "rate_limited" : "invalid_code") : res.status === 0 ? cloudErrorText("offline") : L.openFailed);
        return;
      }
      const d = res.data as { events: PhysicalEvent[]; version: number; hostCode: string; pairToken: string | null };
      const t = replay(d.events);
      const store = await getStore();
      if ((await loadTournament(store, t.id).catch(() => null)) && !window.confirm(L.openReplaceConfirm)) return;
      await saveTournament(store, t);
      saveMeta(t.id, { hostCode: d.hostCode, pairToken: d.pairToken ?? null, syncedVersion: d.version, syncedSig: `${t.events.length}:${t.events[t.events.length - 1]?.id ?? ""}`, keys: {}, ...(tid !== t.id ? { cloudId: tid } : {}) });
      navigate(`/arranger/fysisk/${t.id}`);
    } catch {
      setErr(L.openFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-3">
      <button type="button" className="btn btn-block" aria-expanded={open} aria-controls="open-published" onClick={() => setOpen((o) => !o)}>
        {L.openTitle} <Icon name="chevronDown" size={16} className={open ? "flip" : undefined} />
      </button>
      {open && (
        <form id="open-published" className="stack panel-inset" onSubmit={go}>
          <div className="field">
            <label htmlFor="op-id">{L.openIdLabel}</label>
            <input id="op-id" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="op-code">{L.openCodeLabel}</label>
            <input id="op-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-12" />
          </div>
          {err && <div className="banner banner-error" role="alert">{err}</div>}
          <button type="submit" className="btn btn-primary" disabled={busy || !id.trim() || !code.trim()}>{L.openGo}</button>
        </form>
      )}
    </div>
  );
}
