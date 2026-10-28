"use client";

import { useState } from "react";
import { Icon } from "@/lib/client/Icon";
import { Modal } from "@/lib/client/Modal";
import { no } from "@/lib/locale/no";
import { newId } from "@/lib/physical/events";
import { totalRounds } from "@/lib/physical/reducer";
import { withdrawImpact } from "@/lib/physical/roundView";
import type { PhysicalEventBody, PhysicalPlayer, PhysicalTournament } from "@/lib/physical/schema";

const p = no.physical;

export function PlayersPanel({ t, apply }: { t: PhysicalTournament; apply: (b: PhysicalEventBody) => void }) {
  const [name, setName] = useState("");
  const [rating, setRating] = useState("");
  const [club, setClub] = useState("");
  const [halfMissed, setHalfMissed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [byeFor, setByeFor] = useState<string | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null);

  const running = t.status === "running";
  const late = t.rounds.length > 0;
  const lateSupported = t.settings.system === "monrad" || t.settings.system === "swiss";
  const canAdd = running && (!late || (t.settings.allowLateEntry && lateSupported));
  const byeOk = running && t.settings.system !== "knockout" && t.rounds.length + 1 <= totalRounds(t);
  const lateNote = !late || canAdd ? null : !t.settings.allowLateEntry ? p.lateEntryOff : p.errors.lateEntryUnsupported;

  function add() {
    if (!name.trim()) return;
    const r = rating.trim() === "" ? undefined : Number(rating);
    if (r !== undefined && (!Number.isInteger(r) || r < 0 || r > 3500)) return setErr(p.errors.badRating);
    setErr(null);
    apply({
      type: "addPlayer",
      playerId: newId(),
      name,
      ...(r !== undefined ? { rating: r } : {}),
      ...(club.trim() ? { club } : {}),
      ...(late && halfMissed ? { missedRoundPoints: 0.5 as const } : {}),
    });
    setName("");
    setRating("");
    setClub("");
  }

  const byePl = byeFor ? t.players.find((x) => x.id === byeFor) ?? null : null;
  const wdPl = withdrawFor ? t.players.find((x) => x.id === withdrawFor) ?? null : null;

  return (
    <section className="stack" aria-label={p.overviewPlayers}>
      <p className="eyebrow">{p.overviewPlayers} ({p.playerCount(t.players.length)})</p>
      <ul className="pp-list">
        {t.players.map((pl) => (
          <PlayerItem
            key={pl.id}
            t={t}
            pl={pl}
            groupLabel={t.settings.groupLabel ?? p.playerGroupHeader}
            canBye={byeOk && pl.status === "active"}
            onBye={() => setByeFor(pl.id)}
            onWithdraw={() => setWithdrawFor(pl.id)}
            onReinstate={() => apply({ type: "reinstatePlayer", playerId: pl.id })}
          />
        ))}
      </ul>

      {running && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="eyebrow">{late ? p.lateEntryTitle : p.addPlayer}</p>
          {lateNote && <div className="banner banner-warn" style={{ textAlign: "left" }}>{lateNote}</div>}
          {canAdd && (
            <>
              <div className="pp-form">
                <input className="input" aria-label={p.playerName} placeholder={p.playerName} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
                <input className="input" inputMode="numeric" aria-label={p.playerRating} placeholder={p.rating} value={rating} onChange={(e) => setRating(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
                <input className="input" aria-label={t.settings.groupLabel ?? p.playerGroupHeader} placeholder={t.settings.groupLabel ?? p.playerGroupHeader} value={club} onChange={(e) => setClub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
                <button type="button" className="btn btn-primary" onClick={add} disabled={!name.trim()}>
                  <Icon name="userPlus" size={16} /> {late ? p.addLate : p.addPlayer}
                </button>
              </div>
              {late && (
                <>
                  <label className="pp-check">
                    <input type="checkbox" checked={halfMissed} onChange={(e) => setHalfMissed(e.target.checked)} />
                    <span>{p.lateMissedHalf(t.rounds.length)}</span>
                  </label>
                  <span className="muted" style={{ fontSize: 13 }}>{p.lateEntryNote(t.rounds.length + 1)}</span>
                </>
              )}
            </>
          )}
          {err && <div className="banner banner-error" role="alert">{err}</div>}
        </div>
      )}

      {byePl && (
        <Modal open onClose={() => setByeFor(null)} title={p.byeDialogTitle(byePl.name)} footer={<button type="button" className="btn btn-primary" onClick={() => setByeFor(null)}>{p.byeDone}</button>}>
          <ByeEditor t={t} pl={byePl} apply={apply} />
        </Modal>
      )}
      {wdPl && (
        <WithdrawDialog
          t={t}
          pl={wdPl}
          onCancel={() => setWithdrawFor(null)}
          onConfirm={() => {
            apply({ type: "withdrawPlayer", playerId: wdPl.id, forfeit: true });
            setWithdrawFor(null);
          }}
        />
      )}
    </section>
  );
}

function PlayerItem({ t, pl, groupLabel, canBye, onBye, onWithdraw, onReinstate }: {
  t: PhysicalTournament; pl: PhysicalPlayer; groupLabel: string; canBye: boolean; onBye: () => void; onWithdraw: () => void; onReinstate: () => void;
}) {
  const byes = t.byeRequests.filter((b) => b.playerId === pl.id && b.round > t.rounds.length).sort((a, b) => a.round - b.round);
  const running = t.status === "running";
  return (
    <li className="pp-item" data-withdrawn={pl.status === "withdrawn"}>
      <span className="pp-no">{pl.startNo}</span>
      <div>
        <div className="pp-name">{pl.name}</div>
        <div className="pp-meta">
          {pl.rating !== undefined && <span>{p.rating} {pl.rating}</span>}
          {pl.club && <span>{groupLabel}: {pl.club}</span>}
          <span>{pl.status === "active" ? p.statusActive : p.statusWithdrawn}</span>
          {pl.lateEntryRound !== undefined && <span>{p.lateBadge(pl.lateEntryRound, pl.missedRoundPoints === 0.5)}</span>}
          {byes.map((b) => <span key={b.round}>{p.byeRequested(b.round, b.byeType)}</span>)}
        </div>
      </div>
      {running && (
        <div className="pp-actions">
          {canBye && <button type="button" className="btn btn-sm btn-ghost" onClick={onBye}>{p.byeButton}</button>}
          {pl.status === "active" ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onWithdraw}><Icon name="userMinus" size={14} /> {p.withdraw}</button>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onReinstate}>{p.reinstate}</button>
          )}
        </div>
      )}
    </li>
  );
}

function ByeEditor({ t, pl, apply }: { t: PhysicalTournament; pl: PhysicalPlayer; apply: (b: PhysicalEventBody) => void }) {
  const rounds: number[] = [];
  for (let r = t.rounds.length + 1; r <= totalRounds(t); r++) rounds.push(r);
  if (rounds.length === 0) return <span className="muted">{p.byeNoRounds}</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted" style={{ fontSize: 13 }}>{p.byeDialogHelp}</span>
      {rounds.map((r) => {
        const cur = t.byeRequests.find((b) => b.playerId === pl.id && b.round === r)?.byeType ?? null;
        const set = (type: "half" | "zero" | null) =>
          type ? apply({ type: "requestBye", playerId: pl.id, round: r, byeType: type }) : apply({ type: "cancelByeRequest", playerId: pl.id, round: r });
        return (
          <div key={r} className="pp-byeline">
            <b>{p.byeRoundLabel(r)}</b>
            <span className="pp-seg" role="group" aria-label={p.byeRoundLabel(r)}>
              <button type="button" aria-pressed={cur === null} onClick={() => set(null)}>{p.byeNone}</button>
              <button type="button" aria-pressed={cur === "half"} onClick={() => set("half")}>{p.byeOptHalf}</button>
              <button type="button" aria-pressed={cur === "zero"} onClick={() => set("zero")}>{p.byeOptZero}</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WithdrawDialog({ t, pl, onCancel, onConfirm }: { t: PhysicalTournament; pl: PhysicalPlayer; onCancel: () => void; onConfirm: () => void }) {
  const impact = withdrawImpact(t, pl.id);
  const list = impact.forfeits.map((f) => p.withdrawForfeitItem(f.board, p.results[f.result])).join(", ");
  return (
    <Modal
      open
      onClose={onCancel}
      title={p.withdrawTitle(pl.name)}
      footer={
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{no.common.cancel}</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>{p.withdrawConfirm}</button>
        </div>
      }
    >
      <p style={{ margin: 0 }}>
        {impact.forfeits.length > 0 ? p.withdrawForfeits(list) : impact.inDraft ? p.withdrawDraft : p.withdrawNothing}
      </p>
    </Modal>
  );
}
