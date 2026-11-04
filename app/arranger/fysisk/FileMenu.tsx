"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/client/Icon";
import { InfoTip } from "@/lib/client/InfoTip";
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
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function run(fn: () => Promise<"download" | "newtab"> | "download" | "newtab", isBackup = false) {
    setOpen(false);
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
    <div ref={ref} className="pm-wrap">
      <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {f.menu} <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="card stack pm-pop">
          <button type="button" className="btn btn-sm btn-ghost pm-item" onClick={() => text(FILE_EXT, () => tournamentFileText(t), "application/json", false, true)}>
            {f.downloadJson}
          </button>
          <div className="spread">
            <button type="button" className="btn btn-sm btn-ghost pm-item" onClick={() => text(".trf", () => trf16Text(t), "text/plain")}>
              {f.exportTrf}
            </button>
            <InfoTip align="end">{f.trfNote}</InfoTip>
          </div>
          <button type="button" className="btn btn-sm btn-ghost pm-item" onClick={() => text(".csv", () => standingsCsv(t), "text/csv", false)}>
            {f.exportCsv}
          </button>
          <button type="button" className="btn btn-sm btn-ghost pm-item" onClick={() => text("-partier.csv", () => gamesCsv(t), "text/csv", false)}>
            {f.exportGamesCsv}
          </button>
        </div>
      )}
      {msg && <span className="muted pm-msg" role="status">{msg}</span>}
    </div>
  );
}
