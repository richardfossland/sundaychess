"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { no } from "@/lib/locale/no";
import { NavLink } from "../nav";
import { boardOrder, chunk, fmtPoints } from "@/lib/physical/print/data";
import {
  adjustTimer, formatTimer, newTimer, parseTimer, pauseTimer, resetTimer, startTimer, timerRemaining, pageAt, type TimerState,
} from "@/lib/physical/print/timer";
import { openRound, standings } from "@/lib/physical/selectors";
import { totalRounds } from "@/lib/physical/reducer";
import { useLiveTournament } from "./useLiveTournament";
import "./storskjerm.css";

const L = no.physicalPrint;
const PAGE_MS = 8000;
const IDLE_MS = 3000;

const RESULT_TEXT: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "½-½": "½–½", "+-": "+ –", "-+": "– +", "=": "0–0" };

function useLocal<T>(key: string, parse: (raw: string | null) => T, init: T) {
  const [v, setV] = useState<T>(init);
  useEffect(() => {
    const read = () => {
      try {
        setV(parse(localStorage.getItem(key)));
      } catch {
        /* blokkert lagring */
      }
    };
    read();
    const on = (e: StorageEvent) => e.key === key && read();
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parse er stabil per kall
  }, [key]);
  const set = useCallback(
    (next: T, raw: string | null) => {
      setV(next);
      try {
        if (raw === null) localStorage.removeItem(key);
        else localStorage.setItem(key, raw);
      } catch {
        /* blokkert lagring */
      }
    },
    [key],
  );
  return [v, set] as const;
}

const parseTheme = (raw: string | null) => (raw === "light" ? "light" : "dark");
const parseTimerState = (raw: string | null) => parseTimer(raw);

/** /arranger/fysisk/<id>/storskjerm */
export function Storskjerm({ id }: { id: string }) {
  const { state: t, status, kind } = useLiveTournament(id);
  const [theme, setTheme] = useLocal<"light" | "dark">("chess:storskjerm-theme", parseTheme, "dark");
  const [timer, setTimer] = useLocal<TimerState | null>(`sundaychess:storskjerm-timer:${id}`, parseTimerState, null);
  const [now, setNow] = useState(() => Date.now());
  const [vh, setVh] = useState(800);
  const [tick, setTick] = useState(0);
  const [idle, setIdle] = useState(false);
  const [full, setFull] = useState(false);
  const [minutes, setMinutes] = useState("10");

  useEffect(() => {
    const upd = () => setVh(window.innerHeight);
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);
  useEffect(() => {
    const a = window.setInterval(() => setNow(Date.now()), 250);
    const b = window.setInterval(() => setTick((x) => x + 1), PAGE_MS);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, []);
  useEffect(() => {
    let h: number | undefined;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(h);
      h = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    wake();
    const evs = ["mousemove", "mousedown", "keydown", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, wake));
    return () => {
      window.clearTimeout(h);
      evs.forEach((e) => window.removeEventListener(e, wake));
    };
  }, []);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const saveTimer = (s: TimerState | null) => setTimer(s, s ? JSON.stringify(s) : null);

  // Radhøyde følger høyden; sidestørrelse = hvor mange rader som faktisk får plass.
  const rowH = Math.round(Math.min(96, Math.max(40, vh * 0.075)));
  const areaH = vh * (1 - 0.14) - vh * 0.05 - vh * 0.05; // under toppfeltet, minus kolonnetittel og luft
  const perPage = Math.max(3, Math.floor(areaH / (rowH + vh * 0.005)));

  const view = useMemo(() => {
    if (!t) return null;
    const round = openRound(t) ?? t.rounds[t.rounds.length - 1] ?? null;
    const names = new Map(t.players.map((p) => [p.id, p.name]));
    const games = round ? boardOrder(round.pairings) : [];
    const st = standings(t);
    return { round, names, games, st, hasStandings: t.rounds.some((r) => r.status === "completed") };
  }, [t]);

  if (status === "loading") return <div className="ss-root"><div className="ss-empty" style={{ gridRow: "1 / -1" }}><span className="spin" /></div></div>;
  if (status !== "ready" || !t || !view) {
    return (
      <div className="ss-root">
        <div className="ss-empty" style={{ gridRow: "1 / -1" }}>
          {no.physical.notFound}
          <div><NavLink href="/arranger/fysisk" className="btn">{no.physical.backToList}</NavLink></div>
        </div>
      </div>
    );
  }

  const { round, names, games, st, hasStandings } = view;
  const pairPages = chunk(games, perPage);
  const standPages = chunk(hasStandings ? st : [], perPage);
  const pairPage = pageAt(tick, pairPages.length);
  const standPage = pageAt(tick, standPages.length);
  const remaining = timer ? timerRemaining(timer, now) : 0;
  const running = !!timer && timer.startedAt !== null && remaining > 0;
  const up = !!timer && timer.startedAt !== null && remaining === 0;
  const fontPx = Math.round(rowH * 0.46);
  const rowStyle = { height: rowH, fontSize: fontPx };
  const finished = t.status === "finished";

  const mins = Number(minutes.replace(",", "."));
  const showTimer = !!timer && (timer.durationMs > 0 || timer.remainingMs > 0);

  return (
    <div className={`ss-root ${theme === "light" ? "ss-light" : ""} ${idle ? "ss-idle" : ""}`} data-testid="storskjerm">
      <header className="ss-head">
        <div className="ss-title">
          <h1>{t.title}</h1>
          <p>{round ? `${no.physical.roundN(round.number)} / ${totalRounds(t)}` : L.bigNoRound}</p>
        </div>
        {showTimer && (
          <div className={`ss-clock ${up ? "ss-up" : ""}`} data-testid="ss-clock" aria-live="off">
            {up ? L.timerUp : formatTimer(remaining)}
          </div>
        )}
      </header>

      <div className={`ss-body ${hasStandings ? "" : "ss-single"}`}>
        <section className="ss-col" aria-label={round ? no.physical.roundN(round.number) : L.bigNoRound} data-testid="ss-pairings">
          <div className="ss-col-head">
            <span>{round ? no.physical.roundN(round.number) : L.bigNoRound}</span>
            {pairPages.length > 1 && <span>{pairPage + 1}/{pairPages.length}</span>}
          </div>
          <div className="ss-rows">
            {round && games.length > 0 ? (
              (pairPages[pairPage] ?? []).map((g) => (
                <div key={g.board} className="ss-row ss-row-pair" style={rowStyle} data-testid="ss-row">
                  <span className="ss-n">{g.board}</span>
                  <span>{names.get(g.white) ?? "?"}</span>
                  <span>{g.black === null ? <i className="ss-dim">{no.physical.bye}</i> : (names.get(g.black) ?? "?")}</span>
                  <span className="ss-res" data-testid="ss-result">{g.result ? RESULT_TEXT[g.result] : ""}</span>
                </div>
              ))
            ) : (
              <div className="ss-empty">{L.bigNoRound}</div>
            )}
          </div>
        </section>

        {hasStandings && (
          <section className="ss-col" aria-label={no.physical.standings} data-testid="ss-standings">
            <div className="ss-col-head">
              <span>{finished ? L.finalTitle : no.physical.standings}</span>
              {standPages.length > 1 && <span>{standPage + 1}/{standPages.length}</span>}
            </div>
            <div className="ss-rows">
              {(standPages[standPage] ?? []).map((r) => (
                <div key={r.playerId} className="ss-row ss-row-stand" style={rowStyle}>
                  <span className="ss-n">{r.rank}</span>
                  <span>{r.player.name}</span>
                  <span className="ss-pts">{fmtPoints(r.score)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {kind === "memory" && <div className="ss-tools" role="alert" style={{ left: "1vw", right: "auto", bottom: "auto", top: "15vh" }}>{L.bigNoStorage}</div>}
      <div className="ss-tools" aria-label={L.timer}>
        <button type="button" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>
          {full ? L.bigExitFullscreen : L.bigFullscreen}
        </button>
        <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark", theme === "dark" ? "light" : "dark")}>{L.bigTheme}</button>
        <span aria-hidden>|</span>
        <label>{L.timerMinutes} <input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label={L.timerMinutes} /></label>
        <button type="button" disabled={!(mins > 0)} onClick={() => saveTimer(startTimer(newTimer(mins), Date.now()))}>{L.timerSet}</button>
        {timer && (
          <>
            {running ? (
              <button type="button" onClick={() => saveTimer(pauseTimer(timer, Date.now()))}>{L.timerPause}</button>
            ) : (
              <button type="button" onClick={() => saveTimer(startTimer(timer, Date.now()))}>{L.timerStart}</button>
            )}
            <button type="button" onClick={() => saveTimer(adjustTimer(timer, Date.now(), 1))}>{L.timerPlusMin}</button>
            <button type="button" onClick={() => saveTimer(adjustTimer(timer, Date.now(), -1))}>{L.timerMinusMin}</button>
            <button type="button" onClick={() => saveTimer(resetTimer(timer))}>{L.timerReset}</button>
            <button type="button" onClick={() => saveTimer(null)}>{L.timerHide}</button>
          </>
        )}
      </div>
    </div>
  );
}
