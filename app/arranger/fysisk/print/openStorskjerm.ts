"use client";

// Åpner storskjermen i et eget, navngitt vindu (mønster fra
// sundayturnering/lib/client/boardWindow.ts). Samme navn → samme vindu, så
// ny knappetrykk fokuserer i stedet for å stable kopier. Uten `noopener`,
// ellers returnerer window.open alltid null og blokkering kan ikke oppdages.
const opened = new Map<string, Window>();

export function storskjermPath(id: string): string {
  return `/arranger/fysisk/${encodeURIComponent(id)}/storskjerm`;
}

export function openStorskjerm(id: string): boolean {
  const existing = opened.get(id);
  if (existing && !existing.closed) {
    try {
      existing.focus();
    } catch {
      /* ignorer */
    }
    return true;
  }
  const w = window.open(storskjermPath(id), `sjakk-storskjerm-${id}`, "popup,width=1280,height=800");
  if (!w) return false;
  opened.set(id, w);
  try {
    w.focus();
  } catch {
    /* ignorer */
  }
  return true;
}

export function printPath(id: string, kind: string): string {
  return `/arranger/fysisk/${encodeURIComponent(id)}/skriv/${kind}`;
}
