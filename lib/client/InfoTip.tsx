"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/client/Icon";
import { no } from "@/lib/locale/no";

/** Small ⓘ button that reveals a short explanation on tap/click — so help text
 * that is genuinely useful (tiebreaks, pairing systems, shortcuts) stays out of
 * the layout until someone asks for it. Closes on Esc, outside click or a second
 * tap; works the same with touch, mouse and keyboard. */
export function InfoTip({
  children,
  label = no.common.moreInfo,
  icon = "info",
  align = "center",
}: {
  children: React.ReactNode;
  /** Accessible name of the button (visible text is just the icon). */
  label?: string;
  icon?: IconName;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Keep the popover inside the viewport on narrow screens: measure after it
  // opens and nudge it sideways by however much it sticks out.
  useLayoutEffect(() => {
    if (!open || !pop.current) {
      setShift(0);
      return;
    }
    const gutter = 12;
    const r = pop.current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    if (r.right > vw - gutter) setShift(vw - gutter - r.right);
    else if (r.left < gutter) setShift(gutter - r.left);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="infotip" ref={wrap}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} size={16} />
      </button>
      {open && (
        <span
          id={id}
          ref={pop}
          role="note"
          className={`infotip-pop infotip-${align}`}
          style={shift ? { translate: `${shift}px 0` } : undefined}
        >
          {children}
        </span>
      )}
    </span>
  );
}
