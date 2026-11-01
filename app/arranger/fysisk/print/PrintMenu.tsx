"use client";

import { useEffect, useRef, useState } from "react";
import { no } from "@/lib/locale/no";
import { PRINT_KINDS } from "@/lib/physical/print/data";
import { navigate } from "../nav";
import { openStorskjerm, printPath, storskjermPath } from "./openStorskjerm";
import { Icon } from "@/lib/client/Icon";

const L = no.physicalPrint;

/** Nedtrekksmeny «Skriv ut» for turneringsvisningens topp. Ingen avhengigheter til runde-skjermen. */
export function PrintMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="pm-wrap">
      <button type="button" className="btn btn-sm btn-ghost" aria-haspopup="menu" aria-expanded={open} aria-label={L.menuAria} onClick={() => setOpen((o) => !o)}>
        {L.menu} <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div role="menu" className="card stack pm-pop">
          {PRINT_KINDS.map((k) => (
            <a
              key={k}
              role="menuitem"
              className="btn btn-sm btn-ghost pm-item"
              href={printPath(id, k)}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                setOpen(false);
                navigate(printPath(id, k));
              }}
            >
              {L.kinds[k]}
            </a>
          ))}
          <hr className="pm-sep" />
          <button type="button" role="menuitem" className="btn btn-sm pm-item" onClick={() => { setBlocked(!openStorskjerm(id)); setOpen(false); }}>
            {L.openBig}
          </button>
        </div>
      )}
      {blocked && (
        <a href={storskjermPath(id)} target="_blank" rel="noreferrer" className="btn btn-sm">{L.openBig}</a>
      )}
    </div>
  );
}
