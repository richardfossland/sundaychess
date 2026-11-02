"use client";

import { useState } from "react";
import { no } from "@/lib/locale/no";
import { copyText, downloadPgn } from "@/lib/client/pgnActions";

/** «Last ned PGN» + «Kopier FEN». `load` leverer filnavn, PGN-tekst og FEN ved klikk. */
export function PgnButtons({
  load,
}: {
  load: () => Promise<{ filename: string; pgn: string; fen: string }>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2500);
  };
  const run = async (kind: "pgn" | "fen") => {
    setBusy(true);
    try {
      const r = await load();
      if (kind === "pgn") downloadPgn(r.filename, r.pgn);
      else flash((await copyText(r.fen)) ? no.pgn.fenCopied : no.pgn.fenFailed);
    } catch {
      flash(no.pgn.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack gap-2">
      <div className="row">
        <button className="btn btn-ghost" disabled={busy} onClick={() => run("pgn")}>
          {no.pgn.download}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => run("fen")}>
          {no.pgn.copyFen}
        </button>
      </div>
      <p className="muted fs-xs" role="status" aria-live="polite">
        {note}
      </p>
    </div>
  );
}
