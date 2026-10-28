"use client";

import { useRef, useState } from "react";
import { gamesCsv, standingsCsv } from "@/lib/export/csv";
import { markExported } from "@/lib/physical/exportReminder";
import { downloadText, safeFileName } from "@/lib/export/download";
import { FILE_EXT, tournamentFileText } from "@/lib/export/json";
import { trf16Text } from "@/lib/export/trf16";
import { no } from "@/lib/locale/no";
import type { PhysicalTournament } from "@/lib/physical/schema";

/** «Fil»-meny i turneringshodet: last ned turneringsfil, TRF16, CSV. Alt skjer lokalt (Blob). */
export function FileMenu({ t }: { t: PhysicalTournament }) {
  const f = no.physical.file;
  const ref = useRef<HTMLDetailsElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<"download" | "newtab"> | "download" | "newtab", isBackup = false) {
    if (ref.current) ref.current.open = false;
    try {
      const how = await fn();
      if (isBackup) markExported(t);
      setMsg(how === "newtab" ? f.openedInTab : null);
    } catch {
      setMsg(f.exportFailed);
    }
  }
  const text = (ext: string, body: () => string | Promise<string>, mime: string, bom = false, isBackup = false) =>
    run(async () => downloadText(safeFileName(t.title, ext), await body(), mime, { bom }), isBackup);

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <details ref={ref} className="file-menu">
        <summary className="btn btn-sm btn-ghost" style={{ listStyle: "none", cursor: "pointer" }}>
          {f.menu}
        </summary>
        <div className="card stack" style={{ position: "absolute", right: 0, zIndex: 20, minWidth: 260, padding: 8, gap: 4 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => text(FILE_EXT, () => tournamentFileText(t), "application/json", false, true)}>
            {f.downloadJson}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" title={f.trfNote} onClick={() => text(".trf", () => trf16Text(t), "text/plain")}>
            {f.exportTrf}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => text(".csv", () => standingsCsv(t), "text/csv", false)}>
            {f.exportCsv}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => text("-partier.csv", () => gamesCsv(t), "text/csv", false)}>
            {f.exportGamesCsv}
          </button>
        </div>
      </details>
      {msg && <span className="muted" role="status" style={{ display: "block", fontSize: 12 }}>{msg}</span>}
    </span>
  );
}
