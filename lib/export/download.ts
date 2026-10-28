// Nedlasting via Blob (virker uten nett). Fallback for nettlesere uten `download`-attributt
// (eldre iOS Safari): åpne blob-URL-en i ny fane, der brukeren kan bruke «Del»/«Arkiver».

export interface DownloadEnv {
  document: Pick<Document, "createElement" | "body">;
  URL: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  open: (url: string, target: string) => unknown;
}

function browserEnv(): DownloadEnv {
  return { document, URL, open: (u, t) => window.open(u, t) };
}

/** Returnerer "download" eller "newtab" (hvilken vei som ble brukt). */
export function downloadBlob(filename: string, blob: Blob, env: DownloadEnv = browserEnv()): "download" | "newtab" {
  const url = env.URL.createObjectURL(blob);
  const a = env.document.createElement("a") as HTMLAnchorElement;
  const supportsDownload = "download" in a;
  let how: "download" | "newtab" = "download";
  if (supportsDownload) {
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    env.document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    how = "newtab";
    env.open(url, "_blank");
  }
  // Gi nettleseren tid til å starte nedlastingen før URL-en frigis.
  setTimeout(() => env.URL.revokeObjectURL(url), 60_000);
  return how;
}

export function downloadText(filename: string, text: string, mime: string, opts: { bom?: boolean } = {}) {
  const blob = new Blob([opts.bom ? "﻿" : "", text], { type: `${mime};charset=utf-8` });
  return downloadBlob(filename, blob);
}

/** Trygt filnavn: fjern tegn som ikke er lov på Windows/macOS. */
export function safeFileName(title: string, ext: string): string {
  const base =
    title
      .normalize("NFC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "turnering";
  return `${base}${ext}`;
}
