"use client";

import { useState } from "react";
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
    <details>
      <summary className="btn btn-sm btn-ghost" style={{ listStyle: "none", cursor: "pointer" }}>{L.openTitle}</summary>
      <form className="stack" style={{ gap: 8, marginTop: 8 }} onSubmit={go}>
        <label className="stack" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: 12 }}>{L.openIdLabel}</span>
          <input className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" />
        </label>
        <label className="stack" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: 12 }}>{L.openCodeLabel}</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-12" />
        </label>
        {err && <div className="banner banner-error" role="alert">{err}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !id.trim() || !code.trim()}>{L.openGo}</button>
      </form>
    </details>
  );
}
