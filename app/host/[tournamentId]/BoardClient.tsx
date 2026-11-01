"use client";

import { useEffect, useState } from "react";
import { useBoardState } from "@/lib/client/useBoardState";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { HostFileButton } from "./HostFileButton";
import { DiagnosticsModal } from "./DiagnosticsModal";
import { LobbyView } from "./LobbyView";
import { LeagueView } from "./LeagueView";
import { BracketView } from "./BracketView";
import { FinishedView } from "./FinishedView";
import { LiveGamesView } from "./LiveGamesView";
import { Icon } from "@/lib/client/Icon";
import { Segmented } from "@/lib/client/Segmented";
import { HostBar } from "./HostBar";
import {
  effectiveHostCode,
  settPresentasjon,
  usePresentasjon,
} from "@/lib/client/storskjerm/usePresentasjon";
import { useHideCursor } from "@/lib/client/storskjerm/useHideCursor";
import { StorskjermButton } from "@/lib/client/storskjerm/StorskjermButton";
import { tekst as storskjermTekst } from "@/lib/client/storskjerm/tekst";
import "@/lib/client/storskjerm/storskjerm.css";

export function BoardClient({ tournamentId }: { tournamentId: string }) {
  // Host projector renders the live-games grid → ask for per-game clocks.
  const { state, error, failures, refresh } = useBoardState(tournamentId, true);
  // The host board runs on a projector/TV: never let it dim or sleep.
  useWakeLock();
  // `?visning=tavle`: ren tavle for projektor/TV/cast — ingen vertskontroller.
  const presentasjon = usePresentasjon();
  useHideCursor(presentasjon);
  const [mode, setMode] = useState<"board" | "live">("board");
  // T5 diagnostics: host-code-gated, so the button only appears on the device
  // that actually created this tournament (the code lives in its localStorage).
  const [storedHostCode, setHostCode] = useState<string | null>(null);
  const hostCode = effectiveHostCode(storedHostCode, presentasjon);
  const [showDiag, setShowDiag] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(identity.hostCode(tournamentId));
  }, [tournamentId]);

  // F = fullskjerm i tavlevisning (tastatur på PC/Chromebook koblet til skjermen).
  useEffect(() => {
    if (!presentasjon) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentasjon]);

  // Only blank the projector when we have NOTHING to show. A transient fetch
  // error after we already have state must not wipe the live board — keep the
  // last-good view (the 5 s poll + reconnect resync self-heal); a subtle badge
  // signals the hiccup.
  if (error && !state) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack text-center">
          <h2>{no.common.error}</h2>
          <button className="btn btn-primary btn-lg" onClick={() => refresh()}>
            {no.common.retry}
          </button>
        </div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  const status = state.tournament.status;
  const liveable = status === "league" || status === "playoff";

  const view =
    liveable && mode === "live" ? (
      <LiveGamesView
        state={state}
        onStale={refresh}
        onExitLive={() => setMode("board")}
      />
    ) : status === "league" ? (
      <LeagueView state={state} onChanged={refresh} />
    ) : status === "playoff" ? (
      <BracketView state={state} onChanged={refresh} />
    ) : status === "finished" ? (
      <FinishedView state={state} />
    ) : (
      <LobbyView state={state} onChanged={refresh} />
    );

  // I tavlevisning står skjermen uten tilsyn: vis «mistet kontakten» først
  // etter flere mislykkede runder på rad (~15 s), ikke ved hvert lille hikke.
  const roundBadge =
    status === "league"
      ? `${no.host.round} ${state.tournament.currentRound} / ${state.tournament.config.leagueRounds}`
      : status === "playoff"
        ? no.host.bracket
        : status === "finished"
          ? no.host.finished
          : null;
  const toggle = (
    <Segmented
      aria-label={`${no.host.boardToggle} / ${no.host.liveToggle}`}
      value={mode}
      onChange={setMode}
      options={[
        { value: "board", label: no.host.boardToggle },
        { value: "live", label: <><Icon name="live" size={12} /> {no.host.liveToggle}</> },
      ]}
    />
  );
  const visTilkobling = presentasjon ? failures >= 3 : error;

  return (
    <div className={presentasjon ? "presentasjon" : undefined}>
      {visTilkobling && (
        <div
          className="banner banner-wait conn-badge"
          style={{ left: 20 }}
          role="status"
          aria-live="polite"
        >
          {presentasjon ? storskjermTekst.tavle.tilkobling : no.player.reconnecting}
        </div>
      )}
      {/* Vertens toppfelt (D4): logo + navn + rundemerke på én linje, handlinger
          inline på bred skjerm og i «Mer»-menyen på smal. Tavlevisning har
          bare den lille Storskjerm/Live-veksleren (D6 rydder den). */}
      {!presentasjon && (
        <HostBar
          title={state.tournament.title ?? ""}
          badge={roundBadge}
          toggle={liveable ? toggle : null}
        >
          <StorskjermButton />
          {status !== "playoff" && (status !== "lobby" || state.tournament.currentRound > 0) && state.tournament.config.format !== "cup" && <HostFileButton state={state} />}
          {hostCode && (
            <button
              type="button"
              className="btn btn-ghost host-action"
              data-menu-close
              onClick={() => setShowDiag(true)}
            >
              <Icon name="diag" size={16} /> {no.diag.open}
            </button>
          )}
        </HostBar>
      )}
      {presentasjon && liveable && <div className="presentasjon-veksler">{toggle}</div>}
      {presentasjon && (
        <button
          className="btn btn-ghost presentasjon-avslutt"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            settPresentasjon(false);
          }}
        >
          {storskjermTekst.tavle.avslutt}
        </button>
      )}
      {view}
      {showDiag && hostCode && (
        <DiagnosticsModal
          tournamentId={tournamentId}
          hostCode={hostCode}
          state={state}
          onClose={() => setShowDiag(false)}
        />
      )}
    </div>
  );
}
