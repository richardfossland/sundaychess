"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BoardState } from "@/lib/dto";
import { QRCode } from "@/lib/client/QRCode";
import { identity } from "@/lib/client/identity";
import { api } from "@/lib/client/api";
import { usePresence } from "@/lib/client/usePresence";
import { recordPresence, sweepCandidates } from "@/lib/client/lobbyKick";
import { channels } from "@/lib/realtime";
import { initials } from "@/lib/client/Confetti";
import { teamColor } from "@/lib/tournament/teams";
import { roundsWarning } from "@/lib/tournament/roundsAdvice";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { no } from "@/lib/locale/no";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { NotesModal } from "./NotesModal";
import { Icon } from "@/lib/client/Icon";
import { effectiveHostCode, usePresentasjon } from "@/lib/client/storskjerm/usePresentasjon";

/** A player who has been continuously disconnected for this long while still in
 * the lobby is auto-removed (they left the app). Conservative so a brief wifi
 * blip on a Chromebook never evicts a real student. */
/** Tavlevisning: høyeste antall spillerbrikker før «+N til». Høyt nok til en
 * hel klasse (skaleringen under går ned til minste leselige skrift); bare en
 * uvanlig stor sal kuttes, og da er det de ELDSTE påmeldte som blir «+N til». */
const TV_ROSTER_MAX = 60;

const AUTO_KICK_MS = 3 * 60 * 1000;

export function LobbyView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players } = state;
  // Tavlevisning (projektor/cast): kun det publikum skal se. Ingen vertskode →
  // heller ingen auto-kick-sveip fra denne fanen.
  const presentasjon = usePresentasjon();
  const [joinUrl, setJoinUrl] = useState("");
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The host code is never shown by default (UX-2) — the board is a classroom
  // projector, and this code opens /arranger and /host with full control. A
  // ghost button reveals it on demand, in a tap-to-hide chip that also times
  // itself out so a teacher who forgets doesn't leave it up all lesson.
  const [hostCodeRevealed, setHostCodeRevealed] = useState(false);
  const [hostCodeCopied, setHostCodeCopied] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOST_CODE_REVEAL_MS = 20_000;

  function revealHostCode() {
    setHostCodeRevealed(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHostCodeRevealed(false), HOST_CODE_REVEAL_MS);
  }

  function hideHostCode() {
    setHostCodeRevealed(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }

  async function copyHostCode() {
    if (!hostCode) return;
    try {
      await navigator.clipboard.writeText(hostCode);
      setHostCodeCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setHostCodeCopied(false), 2000);
    } catch {
      // Clipboard permission denied / unsupported — the code is still on
      // screen (revealed) for the teacher to read or select manually.
    }
  }

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // Kick asks for confirmation via the themed dialog (never window.confirm —
  // its OS popup is easy to miss on a projector); the player's name is named
  // in the message so the teacher knows exactly who they're about to remove.
  const [kickTarget, setKickTarget] = useState<{ id: string; name: string } | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    /* eslint-disable react-hooks/set-state-in-effect */
    setJoinUrl(`${base.replace(/\/$/, "")}/play`);
    setHostCode(effectiveHostCode(identity.hostCode(tournament.id), presentasjon));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tournament.id, presentasjon]);

  async function startLeague() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setStarting(true);
    setError(null);
    try {
      await api.startRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
      setStarting(false);
    }
  }

  const active = players.filter((p) => p.status === "active");
  const unclaimed = active.filter((p) => p.preRegistered && !p.claimed).length;
  // Roster is only known once players have joined (see roundsAdvice.ts's doc
  // comment — the arranger wizard runs before that, so it can't check this).
  // The lobby is the first place with a real player count, and the last
  // chance to change the round count before it's baked into every pairing.
  // Tavlevisning: skriften krymper når mange har blitt med. Ingen skjules så
  // lenge tettheten tillater det; over TV_ROSTER_MAX vises de nyeste, og de
  // eldste samles i «+N til» så listen alltid passer i skjermhøyden.
  const shown = presentasjon ? active.slice(-TV_ROSTER_MAX) : active;
  const density =
    active.length <= 12 ? "l" : active.length <= 20 ? "m" : active.length <= 30 ? "s" : "xs";
  const roundsHint = roundsWarning(active.length, tournament.config.leagueRounds);

  // Presence bookkeeping for the conservative auto-kick: a player must have
  // CONNECTED at least once and then been gone continuously past the grace
  // window. Refs (not state) so the stable interval below reads the latest.
  // The rules themselves live in lib/client/lobbyKick.ts, under test.
  const seenRef = useRef<Set<string>>(new Set());
  const leftAtRef = useRef<Map<string, number>>(new Map());
  const kickedRef = useRef<Set<string>>(new Set());
  // Is the HOST's own presence channel healthy, and have we seen a fresh sync
  // since it last (re)subscribed? Both gate the sweep: on a re-join Realtime can
  // hand us an EMPTY presence_state before the class re-announces itself, and
  // stamping that as "everyone left" mass-kicks the room three minutes later.
  const subscribedRef = useRef(false);
  const needsSyncRef = useRef(true);

  // Who's connected right now (students advertise presence keyed by playerId).
  const present = usePresence(
    channels.presence(tournament.id),
    undefined,
    (status) => {
      if (status === "SUBSCRIBED") {
        subscribedRef.current = true;
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED: everything we think we know about
      // who is offline came from a socket that is no longer trustworthy. Throw
      // the absence clock away and wait for a fresh sync before starting it.
      subscribedRef.current = false;
      needsSyncRef.current = true;
      leftAtRef.current.clear();
    },
  );

  const latest = useRef({ active, present, hostCode });
  useEffect(() => {
    latest.current = { active, present, hostCode };
  });

  useEffect(() => {
    recordPresence(
      {
        seen: seenRef.current,
        leftAt: leftAtRef.current,
        kicked: kickedRef.current,
      },
      present,
      Date.now(),
      // The first snapshot after a (re)subscribe is the sync we were waiting
      // for: absorb it, but never stamp anyone absent from it.
      !needsSyncRef.current,
    );
    needsSyncRef.current = false;
    // L5 note: `present` now keeps its reference when MEMBERSHIP is unchanged,
    // so this effect no longer runs on every presence sync in the class — only
    // when someone actually joins or leaves. `recordPresence` was already
    // idempotent for a repeated identical snapshot (it stamps `leftAt` once,
    // and seen/kicked are sets), so the books are unaffected. The one visible
    // consequence is the `needsSync` handshake above: after a resubscribe whose
    // membership is byte-identical there is nothing to absorb, so the latch
    // stays armed until the next snapshot that actually differs — i.e. R4's
    // "don't stamp what our socket may simply not know yet" rule now applies to
    // the first INFORMATIVE snapshot rather than the first snapshot full stop.
    // Strictly more conservative: it can only delay a ghost sweep, never kick
    // someone it wouldn't have.
  }, [present]);

  function resetClaim(playerId: string) {
    if (!hostCode) return;
    api.resetClaim(tournament.id, hostCode, playerId).then(onChanged).catch(() => {});
  }

  function kick(playerId: string) {
    if (!hostCode) return;
    api.kick(tournament.id, hostCode, playerId).then(onChanged).catch(() => {});
  }

  // Stable 30s sweep: drop ghosts who connected then left for > the grace window.
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = latest.current;
      const code = cur.hostCode;
      if (!code) return;
      const ids = sweepCandidates({
        active: cur.active,
        present: cur.present,
        seen: seenRef.current,
        leftAt: leftAtRef.current,
        kicked: kickedRef.current,
        hostSubscribed: subscribedRef.current,
        // A hidden host tab is throttled: its presence view is stale by
        // construction, so it must not evict anyone.
        visible: document.visibilityState === "visible",
        now: Date.now(),
        windowMs: AUTO_KICK_MS,
      });
      for (const id of ids) {
        kickedRef.current.add(id);
        api
          .kick(tournament.id, code, id, "ghost")
          .then(onChanged)
          .catch(() => kickedRef.current.delete(id)); // allow a later retry
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [tournament.id, onChanged]);

  return (
    <main className={`wrap host-main${presentasjon ? " tv-screen tv-lobby" : ""}`}>
      <header className={presentasjon ? "spread host-head-tv reveal" : "host-sub reveal"}>
        {presentasjon && (
          <>
            <span className="brandmark">
              <span className="knight">♞</span> Sunday<b>Chess</b>
            </span>
            {tournament.title && <span className="muted">{tournament.title}</span>}
          </>
        )}
        {!presentasjon && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setShowNotes(true)}>
              <Icon name="edit" size={16} /> {no.host.editNotes}
            </button>
            <span className="grow" />
          </>
        )}
        {!presentasjon && hostCode && (
          hostCodeRevealed ? (
            <div className="host-code-reveal">
              <div className="row gap-2">
                <button
                  type="button"
                  className="badge host-code-badge"
                  title={no.host.tapToHide}
                  onClick={hideHostCode}
                >
                  {no.host.hostCodeLabel}{" "}
                  <span className="mono gold-num">{hostCode}</span>
                </button>
                <button type="button" className="btn btn-ghost" onClick={copyHostCode}>
                  {hostCodeCopied ? no.common.copied : no.common.copy}
                </button>
              </div>
              <span className="tag tag-warn">
                <Icon name="warn" size={14} /> {no.host.hostCodeWarning}
              </span>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={revealHostCode}>
              {no.host.revealHostCode}
            </button>
          )
        )}
      </header>

      <div className="board-grid split-lobby tv-grid">
        {/* Join panel */}
        <section
          className="card stack text-center reveal join-card"
          style={{ ["--i" as string]: 1 } as CSSProperties}
        >
          <p className="eyebrow">{no.host.pinLabel}</p>
          <div className="pin-hero">{tournament.joinPin}</div>
          <p className="join-url">
            <span>Gå til</span>
            <b>{joinUrl.replace(/^https?:\/\//, "")}</b>
          </p>
          {joinUrl && (
            <div className="scale-in qr-frame">
              <QRCode value={joinUrl} size={presentasjon ? 360 : 172} />
            </div>
          )}
          {!presentasjon && (
            <button
              className="btn btn-primary btn-lg join-start"
              disabled={starting || active.length < 2}
              onClick={startLeague}
            >
              {starting ? (
                <span className="spin" />
              ) : tournament.config.format === "cup" ? (
                <><Icon name="cup" size={16} /> {no.host.startCup} →</>
              ) : (
                `${no.host.startLeague} →`
              )}
            </button>
          )}
          {!presentasjon && active.length < 2 && (
            <p className="faint fs-xs">Minst 2 spillere må bli med.</p>
          )}
          {!presentasjon && unclaimed > 0 && (
            <div className="tags" data-testid="unclaimed-hint">
              <span className="tag"><Icon name="users" size={14} /> {no.continueDigital.hostUnclaimedCount(unclaimed)}</span>
            </div>
          )}
          {!presentasjon && roundsHint && (
            <p className="faint fs-xs"><Icon name="warn" size={16} /> {roundsHint}</p>
          )}
          {!presentasjon && error && <div className="banner banner-error">{error}</div>}
        </section>

        {/* Roster */}
        <section className="card stack reveal" style={{ ["--i" as string]: 2 } as CSSProperties}>
          <div className="spread">
            <h2 className="card-title card-title-lg">{no.host.players}</h2>
            <span className="badge badge-live">{active.length}</span>
          </div>
          <hr className="thread" />
          {active.length === 0 ? (
            <p className="muted roster-empty">
              {no.host.noPlayers}
            </p>
          ) : (
            <div className="chips roster-chips" data-density={presentasjon ? density : undefined}>
              {shown.map((p) => {
                const online = present.has(p.id);
                return (
                  <span className="chip" key={p.id}>
                    <span
                      title={online ? no.host.online : no.host.offline}
                      aria-label={online ? no.host.online : no.host.offline}
                      className={`chip-presence${online ? " is-online" : ""}`}
                    />
                    <span className="avatar">{initials(p.displayName)}</span>
                    <span className="chip-name">{p.displayName}</span>
                    {p.preRegistered && (
                      <span
                        className="faint fs-xs"
                        data-testid={p.claimed ? "claimed" : "unclaimed"}
                      >
                        {p.claimed ? no.continueDigital.hostClaimed : no.continueDigital.hostUnclaimed}
                      </span>
                    )}
                    {!presentasjon && p.preRegistered && p.claimed && (
                      <button
                        className="chip-kick"
                        title={no.continueDigital.hostResetClaim}
                        aria-label={`${no.continueDigital.hostResetClaim} ${p.displayName}`}
                        onClick={() => setResetTarget({ id: p.id, name: p.displayName })}
                      >
                        <Icon name="undo" size={14} />
                      </button>
                    )}
                    {p.team && (
                      <span className="team-chip">
                        <span className="team-dot" style={{ background: teamColor(p.team) }} />
                        {p.team}
                      </span>
                    )}
                    {!presentasjon && (
                    <button
                      className="chip-kick"
                      title={no.host.kick}
                      aria-label={`${no.host.kick} ${p.displayName}`}
                      onClick={() => setKickTarget({ id: p.id, name: p.displayName })}
                    >
                      <Icon name="close" size={14} />
                    </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {presentasjon && active.length > shown.length && (
            <p className="tiebreak-note">+{active.length - shown.length} {no.host.moreRows}</p>
          )}
        </section>
      </div>

      <FullscreenToggle />

      {!presentasjon && resetTarget && (
        <ConfirmDialog
          message={no.continueDigital.hostResetConfirm(resetTarget.name)}
          confirmLabel={no.continueDigital.hostResetClaim}
          danger
          onConfirm={() => {
            resetClaim(resetTarget.id);
            setResetTarget(null);
          }}
          onCancel={() => setResetTarget(null)}
        />
      )}

      {!presentasjon && kickTarget && (
        <ConfirmDialog
          message={no.host.kickConfirm(kickTarget.name)}
          confirmLabel={no.host.kick}
          danger
          onConfirm={() => {
            kick(kickTarget.id);
            setKickTarget(null);
          }}
          onCancel={() => setKickTarget(null)}
        />
      )}

      {!presentasjon && showNotes && (
        <NotesModal
          tournamentId={tournament.id}
          hostCode={hostCode ?? ""}
          onClose={() => setShowNotes(false)}
          onSaved={onChanged}
        />
      )}
    </main>
  );
}
