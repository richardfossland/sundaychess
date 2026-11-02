"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConfirmMoves } from "@/lib/client/confirmMoves";
import { BOARD_PALETTES, BOARD_THEMES, useBoardTheme, type BoardTheme } from "@/lib/client/boardOptions";
import { Icon } from "@/lib/client/Icon";
import { Segmented } from "@/lib/client/Segmented";
import { no } from "@/lib/locale/no";

/** Valg av brettfarger (Grønn / Tre / Gull) som `Segmented`. Egen komponent så
 * den kan stå både i oppsettet og i spillvisningen. */
export function BoardThemePicker({ labelledBy }: { labelledBy?: string }) {
  const [theme, setTheme] = useBoardTheme();
  return (
    <Segmented<BoardTheme>
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : no.board.theme}
      className="seg-quarters"
      value={theme}
      onChange={setTheme}
      options={BOARD_THEMES.map((t) => ({
        value: t,
        label: (
          <>
            <span
              className="board-swatch"
              style={{
                background: `linear-gradient(135deg, ${BOARD_PALETTES[t].light} 50%, ${BOARD_PALETTES[t].dark} 50%)`,
              }}
            />
            {t === "contrast" ? no.a11y.themeContrast : no.board[t]}
          </>
        ),
      }))}
    />
  );
}

/** Valgfri trekkbekreftelse (E3): av som standard, lagres per enhet. */
export function ConfirmMovesToggle() {
  const [on, setOn] = useConfirmMoves();
  const id = useId();
  return (
    <label className="switch-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
      />
      <span className="opt-body">
        <span className="opt-title">{no.a11y.confirmMoves}</span>
        <span className="opt-help">{no.a11y.confirmMovesHint}</span>
      </span>
    </label>
  );
}

/** Diskret innstillingsknapp i verktøyraden: åpner brettfargevalget over seg. */
export function BoardThemeMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
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
    <span ref={wrap} className="gl-theme-menu">
      <button
        type="button"
        className="btn btn-ghost gl-icon-btn"
        aria-label={no.board.theme}
        title={no.board.theme}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="palette" size={20} />
      </button>
      {open && (
        <div className="gl-pop" role="group" aria-labelledby={titleId}>
          <span className="gl-pop-title" id={titleId}>
            {no.board.theme}
          </span>
          <BoardThemePicker labelledBy={titleId} />
          <ConfirmMovesToggle />
        </div>
      )}
    </span>
  );
}
