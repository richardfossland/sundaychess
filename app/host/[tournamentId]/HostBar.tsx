"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";

/** Vertens toppfelt: logo + turneringsnavn + rundemerke på én linje, bytte
 * Oversikt/Live ved siden av, og sekundærhandlinger (Vis på storskjerm, Last
 * ned turneringsfil, Diagnostikk) som ligger inline på bred skjerm og samles i
 * «Mer»-menyen under ~1200 px. */
export function HostBar({
  title,
  badge,
  toggle,
  children,
}: {
  title: string;
  badge: string | null;
  toggle: ReactNode;
  /** Sekundærhandlinger. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    // Innholdet er vanlige knapper (ikke role=menu): flytt fokus til første valg,
    // så tastaturbrukeren havner i menyen i stedet for å tabbe forbi den.
    ref.current?.querySelector<HTMLElement>(".host-actions button, .host-actions a[href]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Fokus tilbake til «Mer» hvis det var inne i menyen.
      if (ref.current?.contains(document.activeElement)) moreRef.current?.focus();
    };
    // Tab/fokus ut av menyen lukker den (fokus på null = vinduet mistet fokus: la stå).
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && ref.current && !ref.current.contains(to)) setOpen(false);
    };
    const el = ref.current;
    el?.addEventListener("focusout", onFocusOut);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="host-bar">
      <div className="host-bar-id">
        <span className="brandmark">
          <span className="knight">♞</span>
          <span className="host-bar-word">
            Sunday<b>Chess</b>
          </span>
        </span>
        {title && (
          <span className="host-bar-title muted" title={title}>
            {title}
          </span>
        )}
        {badge && <span className="badge badge-live host-bar-badge">{badge}</span>}
      </div>
      <div className="host-bar-tools" ref={ref}>
        {toggle}
        <button
          type="button"
          className="btn btn-ghost host-more-btn"
          ref={moreRef}
          aria-controls={menuId}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="more" size={16} /> {no.host.more}
        </button>
        <div id={menuId} className={`host-actions${open ? " is-open" : ""}`} onClick={(e) => {
          // Lukk menyen når en vanlig knapp trykkes (modaler åpner seg selv).
          if ((e.target as HTMLElement).closest("[data-menu-close]")) setOpen(false);
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}
