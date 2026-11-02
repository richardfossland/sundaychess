"use client";

import { downloadText } from "@/lib/export/download";
import { PGN_MIME } from "@/lib/export/pgn";

export function downloadPgn(filename: string, text: string) {
  downloadText(filename, text, PGN_MIME);
}

/** Kopierer tekst; faller tilbake til execCommand når Clipboard API mangler. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
