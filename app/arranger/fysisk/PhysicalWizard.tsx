"use client";

import { NavLink, navigate } from "./nav";
import { useMemo, useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { NumberField } from "@/lib/client/NumberField";
import { makeEvent, newId } from "@/lib/physical/events";
import { requestPersistence } from "@/lib/physical/exportReminder";
import { createTournament, reduce } from "@/lib/physical/reducer";
import { parseRoster, type RosterEntry } from "@/lib/physical/roster";
import { PHYSICAL_SYSTEMS, type PhysicalSettings, type PhysicalSystem, type PhysicalTournament } from "@/lib/physical/schema";
import { saveTournament } from "@/lib/physical/storage";
import { bracketRounds, cupBracketSize } from "@/lib/tournament/bracket";
import { roundRobinRounds } from "@/lib/tournament/pairing/roundRobin";
import { DEFAULT_TIEBREAKS, TIEBREAK_KEYS, type TiebreakKey } from "@/lib/tournament/tiebreaks";
import { errorMessage, getStore } from "./usePhysical";

type StepKey = "name" | "system" | "rounds" | "tiebreaks" | "players" | "confirm";
const STEPS: StepKey[] = ["name", "system", "rounds", "tiebreaks", "players", "confirm"];

function derivedRounds(system: PhysicalSystem, n: number, dbl: boolean, chosen: number): number {
  if (system === "roundRobin") return Math.max(1, roundRobinRounds(n, dbl));
  if (system === "knockout") return Math.max(1, bracketRounds(cupBracketSize(n)));
  return chosen;
}

export function PhysicalWizard() {
  const t = no.physical;
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [groupLabel, setGroupLabel] = useState("Klubb");
  const [system, setSystem] = useState<PhysicalSystem>("monrad");
  const [rounds, setRounds] = useState(5);
  const [dbl, setDbl] = useState(false);
  const [lateEntry, setLateEntry] = useState(true);
  const [byeHalf, setByeHalf] = useState(false);
  const [tiebreaks, setTiebreaks] = useState<TiebreakKey[]>([...DEFAULT_TIEBREAKS]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [pName, setPName] = useState("");
  const [pRating, setPRating] = useState("");
  const [pClub, setPClub] = useState("");
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = STEPS[step];
  const totalRounds = derivedRounds(system, roster.length, dbl, rounds);

  const canNext = useMemo(() => {
    if (key === "name") return title.trim().length > 0;
    if (key === "players" || key === "confirm") return roster.length >= 2;
    return true;
  }, [key, title, roster.length]);

  function addOne() {
    const name = pName.trim();
    if (!name) return;
    const r = pRating.trim() === "" ? undefined : Number(pRating);
    if (r !== undefined && (!Number.isInteger(r) || r < 0 || r > 3500)) {
      setError(no.physical.errors.badRating);
      return;
    }
    setError(null);
    setRoster((x) => [...x, { name, ...(r !== undefined ? { rating: r } : {}), ...(pClub.trim() ? { club: pClub.trim() } : {}) }]);
    setPName("");
    setPRating("");
    setPClub("");
  }
  function importPaste() {
    const res = parseRoster(paste);
    setRoster((x) => [...x, ...res.entries]);
    setPasteMsg(t.pasteResult(res.entries.length, res.errors.length));
    setPasteErrors(res.errors.map((e) => t.lineError(e.line, e.message)));
    if (res.entries.length) setPaste("");
  }
  function moveTb(i: number, d: -1 | 1) {
    setTiebreaks((x) => {
      const j = i + d;
      if (j < 0 || j >= x.length) return x;
      const c = x.slice();
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const settings: PhysicalSettings = {
        system,
        rounds: totalRounds,
        ...(system === "roundRobin" ? { doubleRoundRobin: dbl } : {}),
        tiebreaks,
        byePoints: byeHalf ? 0.5 : 1,
        allowLateEntry: system === "monrad" || system === "swiss" ? lateEntry : false,
        groupLabel,
      };
      let state: PhysicalTournament = createTournament({ id: newId(), title, settings });
      for (const p of roster) {
        state = reduce(state, makeEvent({ type: "addPlayer", playerId: newId(), name: p.name, rating: p.rating, club: p.club }));
      }
      await saveTournament(await getStore(), state);
      void requestPersistence(); // best effort: be nettleseren la oss beholde lokale data
      navigate(`/arranger/fysisk/${state.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  function next() {
    setError(null);
    if (step === STEPS.length - 1) void create();
    else setStep((s) => s + 1);
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack scale-in">
        <div className="spread">
          <p className="eyebrow">
            {no.wizard.step} {step + 1} {no.wizard.of} {STEPS.length}
          </p>
          <div className="row" style={{ gap: 6 }}>
            {STEPS.map((s, i) => (
              <span key={s} style={{ width: 22, height: 4, borderRadius: 4, background: i <= step ? "var(--gold)" : "var(--ink-soft)" }} />
            ))}
          </div>
        </div>

        {key === "name" && (
          <div className="field">
            <label htmlFor="pn">{t.nameLabel}</label>
            <input id="pn" className="input" autoFocus maxLength={80} placeholder={t.namePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} />
            <label style={{ marginTop: 10 }}>{t.groupLabelLabel}</label>
            <div className="row">
              {["Klubb", "Klasse"].map((g) => (
                <button key={g} type="button" className={`btn grow ${groupLabel === g ? "btn-primary" : "btn-ghost"}`} aria-pressed={groupLabel === g} onClick={() => setGroupLabel(g)}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {key === "system" && (
          <div className="stack">
            <p className="field">{t.systemLabel}</p>
            <div className="stack" style={{ gap: 8 }}>
              {PHYSICAL_SYSTEMS.map((s) => (
                <button key={s} type="button" className={`btn btn-block ${system === s ? "btn-primary" : "btn-ghost"}`} style={{ textAlign: "left", padding: "12px 16px" }} aria-pressed={system === s} onClick={() => setSystem(s)}>
                  <b>{t.systems[s].label}</b>
                  <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}>{t.systems[s].help}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {key === "rounds" && (
          <div className="stack">
            <p className="field" id="rounds-label">{t.roundsLabel}</p>
            {(system === "monrad" || system === "swiss") && (
              <>
                <div role="group" aria-labelledby="rounds-label" style={{ display: "grid", justifyItems: "center" }}>
                  <NumberField value={rounds} onChange={setRounds} min={1} max={15} aria-label={t.roundsLabel} className="numfield-hero-wrap" hero />
                </div>
                <span className="muted text-center" style={{ fontSize: 13 }}>{t.roundsHint}</span>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={lateEntry} onChange={(e) => setLateEntry(e.target.checked)} /> {t.allowLateEntry}
                </label>
                <div className="field">
                  <label>{t.byePointsLabel}</label>
                  <div className="row">
                    <button type="button" className={`btn grow ${!byeHalf ? "btn-primary" : "btn-ghost"}`} aria-pressed={!byeHalf} onClick={() => setByeHalf(false)}>{t.byeFull}</button>
                    <button type="button" className={`btn grow ${byeHalf ? "btn-primary" : "btn-ghost"}`} aria-pressed={byeHalf} onClick={() => setByeHalf(true)}>{t.byeHalf}</button>
                  </div>
                </div>
              </>
            )}
            {system === "roundRobin" && (
              <>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={dbl} onChange={(e) => setDbl(e.target.checked)} /> {t.doubleRoundRobin}
                </label>
                <span className="muted" style={{ fontSize: 13 }}>{t.roundsAuto(totalRounds)}</span>
              </>
            )}
            {system === "knockout" && <span className="muted" style={{ fontSize: 13 }}>{t.roundsAuto(totalRounds)}</span>}
          </div>
        )}

        {key === "tiebreaks" && (
          <div className="stack">
            <p className="field">{t.tiebreaksLabel}</p>
            <span className="muted" style={{ fontSize: 13 }}>{t.tiebreaksHint}</span>
            <ol className="stack" style={{ gap: 6, paddingLeft: 0, listStyle: "none" }}>
              {tiebreaks.map((k, i) => (
                <li key={k} className="spread" style={{ gap: 8 }}>
                  <span className="grow">
                    <b>{i + 1}. {no.tiebreaks[k].label}</b>
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>{no.tiebreaks[k].help}</span>
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={t.moveUp} disabled={i === 0} onClick={() => moveTb(i, -1)}>↑</button>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={t.moveDown} disabled={i === tiebreaks.length - 1} onClick={() => moveTb(i, 1)}>↓</button>
                    <button type="button" className="btn btn-sm btn-ghost" aria-label={t.removePlayer} onClick={() => setTiebreaks((x) => x.filter((y) => y !== k))}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="chips">
              {TIEBREAK_KEYS.filter((k) => !tiebreaks.includes(k)).map((k) => (
                <button key={k} type="button" className="btn btn-sm btn-ghost" title={no.tiebreaks[k].help} onClick={() => setTiebreaks((x) => [...x, k])}>
                  + {no.tiebreaks[k].label}
                </button>
              ))}
            </div>
          </div>
        )}

        {key === "players" && (
          <div className="stack">
            <p className="field">{t.playersLabel} ({t.playerCount(roster.length)})</p>
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" aria-label={t.playerName} placeholder={t.playerName} value={pName} onChange={(e) => setPName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} />
              <div className="row">
                <input className="input grow" inputMode="numeric" aria-label={t.playerRating} placeholder={t.playerRating} value={pRating} onChange={(e) => setPRating(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} />
                <input className="input grow" aria-label={t.playerGroup} placeholder={groupLabel} value={pClub} onChange={(e) => setPClub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} />
              </div>
              <button type="button" className="btn" onClick={addOne} disabled={!pName.trim()}>{t.addPlayer}</button>
            </div>
            <div className="field">
              <label htmlFor="paste">{t.pasteLabel}</label>
              <textarea id="paste" className="input" rows={4} placeholder={t.pastePlaceholder} value={paste} onChange={(e) => setPaste(e.target.value)} style={{ resize: "vertical" }} />
              <button type="button" className="btn" onClick={importPaste} disabled={!paste.trim()}>{t.pasteImport}</button>
              {pasteMsg && <span className="muted" style={{ fontSize: 13 }}>{pasteMsg}</span>}
              {pasteErrors.map((m) => (
                <span key={m} className="banner banner-error" style={{ fontSize: 12 }}>{m}</span>
              ))}
            </div>
            {roster.length < 2 && <span className="muted" style={{ fontSize: 13 }}>{t.needTwoPlayers}</span>}
            <ol className="stack" style={{ gap: 4, paddingLeft: 0, listStyle: "none" }}>
              {roster.map((p, i) => (
                <li key={`${p.name}-${i}`} className="spread">
                  <span>
                    {i + 1}. <b>{p.name}</b>
                    <span className="muted"> {p.rating ?? ""} {p.club ?? ""}</span>
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t.removePlayer} ${p.name}`} onClick={() => setRoster((x) => x.filter((_, j) => j !== i))}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {key === "confirm" && (
          <div className="stack">
            <p className="eyebrow">{t.confirmTitle}</p>
            <Row label={t.nameLabel} value={title.trim()} />
            <Row label={t.rowSystem} value={t.systems[system].label} />
            <Row label={t.rowRounds} value={totalRounds} />
            <Row label={t.rowTiebreaks} value={tiebreaks.map((k) => no.tiebreaks[k].label).join(", ") || "–"} />
            <Row label={t.rowPlayers} value={roster.length} />
          </div>
        )}

        {error && <div className="banner banner-error" role="alert">{error}</div>}

        <div className="row" style={{ marginTop: 8 }}>
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              <Icon name="back" size={16} /> {no.common.back}
            </button>
          ) : (
            <NavLink href="/arranger/fysisk" className="btn btn-ghost">
              <Icon name="back" size={16} /> {no.common.back}
            </NavLink>
          )}
          <button type="button" className="btn btn-primary grow" onClick={next} disabled={busy || !canNext}>
            {busy ? <span className="spin" /> : step === STEPS.length - 1 ? t.confirmCreate : no.common.next}
          </button>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="spread">
      <span className="muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}
