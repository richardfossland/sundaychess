// Sky-synk for fysiske turneringer (M5a). LOKAL-FØRST: den lokale hendelsesloggen
// er alltid sannhetskilden og turneringen virker uten nett som før. Her ligger
// bare «hold skyen à jour når vi kan»:
//
//   * etter hver lokale endring pushes loggen (debounced) med baseVersion;
//   * utboks = selve den lokale loggen (vi sender alltid siste state, så en
//     mislykket push aldri taper noe), prøver på nytt med eksponentiell backoff
//     og straks når nettleseren melder `online`;
//   * serveren er idempotent (samme innhold = 200), så dobbelt-send er trygt;
//   * 409 = en annen enhet har endret turneringen -> status `conflict`, vi
//     slutter å pushe til brukeren velger «last skyversjon» eller «overskriv».
//
// Motoren er ren (ingen React, ingen fetch direkte) slik at den kan enhetstestes
// med falsk transport og falske timere.

import { loadMeta, saveMeta, clearMeta, type CloudMeta } from "./cloudMeta";
import { logLimitError, type PublicNames, type ReportDto } from "./cloudTypes";
import { newId } from "./events";
import type { PhysicalEvent } from "./schema";

export type CloudStatus = "unpublished" | "synced" | "pending" | "offline" | "conflict" | "error";

export interface HttpResult {
  /** 0 = nettverksfeil/tidsavbrudd. */
  status: number;
  data: Record<string, unknown>;
}
export type Transport = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  auth: { hostCode: string; pairToken: string | null } | null,
) => Promise<HttpResult>;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
}

export const sigOf = (events: readonly PhysicalEvent[]): string =>
  `${events.length}:${events[events.length - 1]?.id ?? ""}`;

const LIMIT_CODES = new Set(["too_many_events", "too_many_players", "payload_too_large"]);
export const DEBOUNCE_MS = 800;
export const BACKOFF_START_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

export interface CloudState {
  status: CloudStatus;
  /** Feilkode fra serveren når status = error (f.eks. invalid_log). */
  errorCode: string | null;
  /** Serverens versjon når status = conflict. */
  serverVersion: number | null;
}

export class CloudSync {
  private state: CloudState = { status: "unpublished", errorCode: null, serverVersion: null };
  private listeners = new Set<() => void>();
  private latest: readonly PhysicalEvent[] | null = null;
  private inFlight = false;
  private again = false;
  private timer: unknown = null;
  private backoff = BACKOFF_START_MS;

  constructor(
    readonly id: string,
    private readonly transport: Transport,
    private readonly timers: Timers = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  ) {
    if (loadMeta(id)) this.state = { ...this.state, status: "synced" };
  }

  // ---- tilstand ----
  getState = (): CloudState => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(patch: Partial<CloudState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  meta = (): CloudMeta | null => loadMeta(this.id);
  /** Skyens id for denne turneringen (kan avvike fra den lokale). */
  private get cid(): string {
    return this.meta()?.cloudId ?? this.id;
  }
  private auth() {
    const m = this.meta();
    return m ? { hostCode: m.hostCode, pairToken: m.pairToken } : null;
  }
  dispose() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  // ---- publisering ----
  async publish(
    events: readonly PhysicalEvent[],
    opts: { publicNames?: PublicNames } = {},
  ): Promise<{ ok: true } | { ok: false; code: string }> {
    const limit = logLimitError(events);
    if (limit) return { ok: false, code: limit };
    // Id-kollisjon (noen har publisert samme id uten at vi eier den): velg en ny sky-id og prøv igjen.
    let candidate = this.cid;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.transport(
        "POST",
        "/api/physical/publish",
        { events, cloudId: candidate, ...(opts.publicNames ? { publicNames: opts.publicNames } : {}) },
        null,
      );
      if (res.status === 200 || res.status === 201) {
        const d = res.data as { id?: string; hostCode: string; pairToken: string | null; version: number };
        const cloudId = d.id && d.id !== this.id ? d.id : undefined;
        saveMeta(this.id, {
          hostCode: d.hostCode,
          pairToken: d.pairToken ?? null,
          syncedVersion: d.version,
          syncedSig: sigOf(events),
          ...(cloudId ? { cloudId } : {}),
          keys: loadMeta(this.id)?.keys ?? {},
        });
        this.latest = events;
        this.set({ status: "synced", errorCode: null, serverVersion: null });
        return { ok: true };
      }
      if (res.status === 409 && res.data.error === "already_published") {
        candidate = newId();
        continue;
      }
      return { ok: false, code: res.status === 0 ? "offline" : String(res.data.error ?? "server_error") };
    }
    return { ok: false, code: "already_published" };
  }

  async unpublish(): Promise<{ ok: boolean; code?: string }> {
    const a = this.auth();
    if (!a) return { ok: true };
    const res = await this.transport("DELETE", `/api/physical/${this.cid}`, null, a);
    if (res.status === 200 || res.status === 404) {
      if (this.timer !== null) this.timers.clear(this.timer);
      this.timer = null;
      clearMeta(this.id);
      this.set({ status: "unpublished", errorCode: null, serverVersion: null });
      return { ok: true };
    }
    return { ok: false, code: res.status === 0 ? "offline" : String(res.data.error ?? "server_error") };
  }

  /** Etter «åpne publisert turnering» på en annen enhet. */
  adopt(meta: CloudMeta) {
    saveMeta(this.id, meta);
    this.set({ status: "synced", errorCode: null, serverVersion: null });
  }

  // ---- push ----
  /** Kall etter hver lokale endring (og ved oppstart med gjeldende logg). */
  notifyLocalChange(events: readonly PhysicalEvent[]) {
    this.latest = events;
    const m = this.meta();
    if (!m) return;
    if (m.syncedSig === sigOf(events)) {
      if (this.state.status === "pending" || this.state.status === "offline") this.set({ status: "synced" });
      return;
    }
    // En størrelsesfeil forsvinner av seg selv hvis loggen igjen er innenfor (f.eks. etter angre).
    if (this.state.status === "error" && this.state.errorCode && LIMIT_CODES.has(this.state.errorCode) && !logLimitError(events)) {
      this.set({ status: "pending", errorCode: null });
    }
    if (this.state.status === "conflict" || this.state.status === "error") return;
    this.set({ status: this.state.status === "offline" ? "offline" : "pending" });
    this.schedule(DEBOUNCE_MS);
  }

  private schedule(ms: number) {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.pushNow();
    }, ms);
  }

  /** Nettleseren er online igjen (eller brukeren trykket «prøv igjen»). */
  retryNow() {
    if (this.state.status === "offline" || this.state.status === "pending") {
      this.backoff = BACKOFF_START_MS;
      this.schedule(0);
    }
  }

  async pushNow(): Promise<void> {
    const m = this.meta();
    const events = this.latest;
    if (!m || !events) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    if (m.syncedSig === sigOf(events)) return;
    const limit = logLimitError(events);
    if (limit) {
      // For stor til skyen: lokalt går alt som før, men vi slutter å pushe og sier fra.
      this.set({ status: "error", errorCode: limit });
      return;
    }
    this.inFlight = true;
    const sent = sigOf(events);
    let res: HttpResult;
    try {
      res = await this.transport(
        "PUT",
        `/api/physical/${this.cid}/log`,
        { events, baseVersion: m.syncedVersion },
        { hostCode: m.hostCode, pairToken: m.pairToken },
      );
    } finally {
      this.inFlight = false;
    }
    if (res.status === 200) {
      const cur = loadMeta(this.id);
      if (cur) saveMeta(this.id, { ...cur, syncedVersion: Number(res.data.version), syncedSig: sent });
      this.backoff = BACKOFF_START_MS;
      const moved = this.latest !== null && sigOf(this.latest) !== sent;
      if (moved || this.again) {
        this.again = false;
        this.set({ status: "pending", errorCode: null });
        this.schedule(DEBOUNCE_MS);
      } else this.set({ status: "synced", errorCode: null });
      return;
    }
    if (res.status === 409 && res.data.error === "version_conflict") {
      this.set({ status: "conflict", serverVersion: Number(res.data.version) || null, errorCode: null });
      return;
    }
    if (res.status === 401 || res.status === 404 || res.status === 413 || res.status === 422 || res.status === 400) {
      // Permanent: koden er avvist / turneringen finnes ikke lenger i skyen / loggen er ugyldig.
      this.set({ status: "error", errorCode: String(res.data.error ?? "server_error") });
      return;
    }
    // 0 / 429 / 5xx: forbigående -> backoff.
    this.set({ status: "offline", errorCode: null });
    this.schedule(this.backoff);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS);
  }

  // ---- konflikt ----
  /** «Last skyversjon»: returnerer skyens logg (kalleren erstatter lokal tilstand og kaller markSynced). */
  async fetchCloudLog(): Promise<{ events: PhysicalEvent[]; version: number } | null> {
    const a = this.auth();
    if (!a) return null;
    const res = await this.transport("GET", `/api/physical/${this.cid}/log`, null, a);
    if (res.status !== 200) return null;
    return { events: res.data.events as PhysicalEvent[], version: Number(res.data.version) };
  }

  /** Lokal logg == skyversjon `version` (etter «last skyversjon»). */
  markSynced(events: readonly PhysicalEvent[], version: number) {
    const m = this.meta();
    if (!m) return;
    saveMeta(this.id, { ...m, syncedVersion: version, syncedSig: sigOf(events) });
    this.latest = events;
    this.set({ status: "synced", errorCode: null, serverVersion: null });
  }

  /** «Overskriv»: behold lokal logg, bruk skyens nåværende versjon som base og push på nytt. */
  async overwriteCloud(): Promise<void> {
    const m = this.meta();
    const v = this.state.serverVersion;
    if (!m || v === null) return;
    saveMeta(this.id, { ...m, syncedVersion: v, syncedSig: null });
    this.set({ status: "pending", serverVersion: null, errorCode: null });
    await this.pushNow();
  }

  // ---- bordnøkler og rapporter ----
  /** Hent og cache bordnøklene (k) for en runde, slik at QR kan skrives ut uten nett. */
  async ensureBoardKeys(round: number, boards: number): Promise<boolean> {
    const m = this.meta();
    if (!m) return false;
    let all = true;
    for (let b = 1; b <= boards; b++) if (!m.keys[`${round}|${b}`]) all = false;
    if (all) return true;
    const res = await this.transport("GET", `/api/physical/${this.cid}/keys?round=${round}&boards=${boards}`, null, {
      hostCode: m.hostCode,
      pairToken: m.pairToken,
    });
    if (res.status !== 200) return false;
    const cur = loadMeta(this.id) ?? m;
    saveMeta(this.id, { ...cur, keys: { ...cur.keys, ...(res.data.keys as Record<string, string>) } });
    return true;
  }

  async fetchReports(): Promise<ReportDto[] | null> {
    const a = this.auth();
    if (!a) return null;
    const res = await this.transport("GET", `/api/physical/${this.cid}/reports`, null, a);
    return res.status === 200 ? (res.data.reports as ReportDto[]) : null;
  }

  async decideReport(reportId: string, action: "approve" | "reject"): Promise<boolean> {
    const a = this.auth();
    if (!a) return false;
    const res = await this.transport("POST", `/api/physical/${this.cid}/reports/${reportId}`, { action }, a);
    return res.status === 200;
  }
}

/** Ekte transport over fetch med tidsavbrudd. Nettverksfeil -> status 0. */
export const fetchTransport: Transport = async (method, path, body, auth) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const headers: Record<string, string> = {};
    if (body !== null) headers["content-type"] = "application/json";
    if (auth) {
      headers["x-host-code"] = auth.hostCode;
      if (auth.pairToken) headers["x-pair-token"] = auth.pairToken;
    }
    const res = await fetch(path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* ikke vår API (HTML-feilside) */
    }
    // Ikke-JSON 4xx/5xx fra en kant/proxy er ikke et svar fra oss: behandle som forbigående.
    if (!res.ok && typeof data.error !== "string") return { status: 0, data: {} };
    return { status: res.status, data };
  } catch {
    return { status: 0, data: {} };
  } finally {
    clearTimeout(timeout);
  }
};
