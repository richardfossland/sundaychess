"use client";

import type { ReactNode } from "react";
import { BoardThemeMenu } from "@/lib/client/BoardThemeMenu";
import { useBoardTheme } from "@/lib/client/boardOptions";

export interface GameLayoutProps {
  /** Tur-status / banner. Øverst i sidepanelet (bred) eller over brettet (smal). */
  status?: ReactNode;
  /** Motstanderens spillerlinje (over brettet). */
  top: ReactNode;
  /** Din spillerlinje (under brettet). */
  bottom: ReactNode;
  /** Selve brettet (PlayBoard eller et sjakkbrett). Legges i `.board-shell`. */
  board: ReactNode;
  boardLabel?: string;
  /** Lagt oppå brettrammen (reaksjoner). */
  boardOverlay?: ReactNode;
  /** Evaluering ved siden av brettet (coach). */
  evalBar?: ReactNode;
  /** Trekklisten. */
  moves?: ReactNode;
  /** Handlingsknapper (Angre / Nytt parti / Tilbake, eller Remis / Gi opp). */
  actions?: ReactNode;
  /** Ekstra meldinger og kontroller mellom handlinger og trekkliste. */
  extra?: ReactNode;
  /** Lyd, fullskjerm, varsler: hjørneknappene, i verktøyraden ved siden av brettfargevalget. */
  tools?: ReactNode;
  /** Turneringsparti har flere rader (timer, reaksjoner, varsler) på smal skjerm. */
  rich?: boolean;
  /** E3: «Bekreft / Angre» for et foreløpig trekk, rett under brettet (MoveConfirmBar). */
  confirm?: ReactNode;
  /** Trekkbekreftelse er slått på: reserver et fast spor (samme høyde med og uten
   * foreløpig trekk) så brettet og resten av siden ikke hopper midt i partiet.
   * Av: ingen plass reservert. */
  reserveConfirm?: boolean;
  /** E3: teksten skjermleseren leser opp (trekk og partislutt). Se useMoveAnnouncer. */
  announcement?: string;
  /** Overlegg og dialoger (resultat, bekreftelser). Arver brettfargene. */
  children?: ReactNode;
}

/**
 * Felles spillvisning (D2). Bred skjerm (>= 1024 px): brett med spillerlinjer
 * til venstre, sidepanel til høyre; brettet skaleres så alt passer i vindus-
 * høyden. Smal skjerm: én kolonne. Rekkefølgen i DOM er sidepanelets; `order`
 * i CSS ordner kolonnen på mobil. Brettfargene (`data-board-theme`) gjelder alt
 * innenfor, inkludert overlegg med replay.
 */
export function GameLayout({
  status,
  top,
  bottom,
  board,
  boardLabel,
  boardOverlay,
  evalBar,
  moves,
  actions,
  extra,
  tools,
  rich,
  confirm,
  reserveConfirm,
  announcement,
  children,
}: GameLayoutProps) {
  const [theme] = useBoardTheme();
  return (
    <main
      className={`game-page${rich ? " gl-rich" : ""}${reserveConfirm ? " has-confirm" : ""}`}
      data-board-theme={theme}
    >
      <div className={`game-layout${evalBar ? " has-eval" : ""}`}>
        <div className="gl-main">
          <div className="gl-top">{top}</div>
          <div className="gl-boardrow">
            {evalBar}
            <div className="board-frame">
              <div
                className="board-shell"
                data-testid="board-shell"
                role="group"
                aria-label={boardLabel}
              >
                {board}
              </div>
              {boardOverlay}
            </div>
          </div>
          <div className="gl-bottom">{bottom}</div>
          {reserveConfirm ? (
            <div
              className="gl-confirm gl-confirm-slot"
              data-empty={confirm ? undefined : "true"}
              data-testid="confirm-slot"
            >
              {confirm}
            </div>
          ) : (
            confirm && <div className="gl-confirm">{confirm}</div>
          )}
        </div>
        <div className="gl-aside">
          {status && <div className="gl-status">{status}</div>}
          <div className="gl-extra">{extra}</div>
          {moves && <div className="gl-moves">{moves}</div>}
          {actions && <div className="gl-actions">{actions}</div>}
          <div className="gl-tools">
            {tools}
            <BoardThemeMenu />
          </div>
        </div>
      </div>
      {/* Én live-region per brettvisning (E3): leser både eget og motstanderens
          trekk og partislutt. Alltid montert, ellers leses første melding ikke. */}
      <div
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="move-announcer"
      >
        {announcement}
      </div>
      {children}
    </main>
  );
}
