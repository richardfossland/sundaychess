// Hendelsesoppretting. Selve valideringen av hendelsene ligger i reducer.ts.

import type { PhysicalEvent, PhysicalEventBody } from "./schema";

/** uuid v4. crypto.randomUUID finnes i alle moderne nettlesere og Node 19+; fallback for gamle. */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

export interface EventMeta {
  id?: string;
  at?: string;
}

/** Pakker en hendelse med id og tidsstempel. Rene tester sender inn egne meta. */
export function makeEvent(body: PhysicalEventBody, meta: EventMeta = {}): PhysicalEvent {
  return { ...body, id: meta.id ?? newId(), at: meta.at ?? new Date().toISOString() } as PhysicalEvent;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function isIsoTimestamp(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));
}
