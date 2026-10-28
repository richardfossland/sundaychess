"use client";

import { useSyncExternalStore } from "react";
import { CloudSync, fetchTransport, type CloudState } from "@/lib/physical/cloud";
import type { ReportDto } from "@/lib/physical/cloudTypes";

const engines = new Map<string, CloudSync>();
let onlineHooked = false;

/** Én synk-motor per turnering per fane. */
export function getCloud(id: string): CloudSync {
  let c = engines.get(id);
  if (!c) {
    c = new CloudSync(id, fetchTransport);
    engines.set(id, c);
  }
  if (!onlineHooked && typeof window !== "undefined") {
    onlineHooked = true;
    window.addEventListener("online", () => engines.forEach((e) => e.retryNow()));
  }
  return c;
}

/** Kalles av lagringskøen etter vellykket lokal lagring: push til skyen hvis turneringen er publisert. */
export function cloudSaved(t: { id: string; events: readonly import("@/lib/physical/schema").PhysicalEvent[] }): void {
  engines.get(t.id)?.notifyLocalChange(t.events);
}

const SERVER: CloudState = { status: "unpublished", errorCode: null, serverVersion: null };

export function useCloudState(id: string): CloudState {
  const c = getCloud(id);
  return useSyncExternalStore(c.subscribe, c.getState, () => SERVER);
}

// Delt poller per turnering (flere komponenter – brett-merker og oppsummering – bruker samme data).
interface RepStore { reports: ReportDto[]; subs: Set<() => void>; timer: number | null; load: () => Promise<void>; onVis: () => void }
const stores = new Map<string, RepStore>();

function repStore(id: string): RepStore {
  let st = stores.get(id);
  if (!st) {
    const s: RepStore = {
      reports: [],
      subs: new Set(),
      timer: null,
      onVis: () => {
        if (!document.hidden) void s.load();
      },
      load: async () => {
        if (document.hidden) return;
        const r = await getCloud(id).fetchReports();
        if (r) {
          s.reports = r;
          s.subs.forEach((f) => f());
        }
      },
    };
    st = s;
    stores.set(id, st);
  }
  return st;
}

const NONE: ReportDto[] = [];

function attach(st: RepStore, cb: () => void): () => void {
  st.subs.add(cb);
  if (st.subs.size === 1) {
    void st.load();
    st.timer = window.setInterval(() => void st.load(), 10_000);
    document.addEventListener("visibilitychange", st.onVis);
  }
  return () => {
    st.subs.delete(cb);
    if (st.subs.size === 0) {
      if (st.timer !== null) window.clearInterval(st.timer);
      st.timer = null;
      document.removeEventListener("visibilitychange", st.onVis);
    }
  };
}

/** Poller ventende spillermeldinger hvert 10. sekund mens fanen er synlig og `active`. */
export function useReports(id: string, active: boolean): { reports: ReportDto[]; refresh: () => void } {
  const st = repStore(id);
  const reports = useSyncExternalStore(
    (cb) => (active ? attach(st, cb) : () => {}),
    () => st.reports,
    () => NONE,
  );
  return { reports: active ? reports : NONE, refresh: () => void st.load() };
}
