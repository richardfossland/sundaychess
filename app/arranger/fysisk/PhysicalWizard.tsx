"use client";

import { NavLink, navigate } from "./nav";
import { useMemo, useState } from "react";
import { no } from "@/lib/locale/no";
import { Icon } from "@/lib/client/Icon";
import { InfoTip } from "@/lib/client/InfoTip";
import { NumberField } from "@/lib/client/NumberField";
import { PageHeader } from "@/lib/client/PageHeader";
import { Segmented } from "@/lib/client/Segmented";
import { Stepper } from "@/lib/client/Stepper";
import { makeEvent, newId } from "@/lib/physical/events";
import { requestPersistence } from "@/lib/physical/exportReminder";
import { createTournament, reduce } from "@/lib/physical/reducer";
import { parseRoster, type RosterEntry } from "@/lib/physical/roster";
import { PHYSICAL_SYSTEMS, type PhysicalSettings, type PhysicalSystem, type PhysicalTournament } from "@/lib/physical/schema";
import { saveTournament } from "@/lib/physical/storage";
import { bracketRounds, cupBracketSize } from "@/lib/tournament/bracket";
import { roundRobinRounds } from "@/lib/tournament/pairing/roundRobin";
import { roundsWarning } from "@/lib/tournament/roundsAdvice";
import { DEFAULT_TIEBREAKS, TIEBREAK_KEYS, type TiebreakKey } from "@/lib/tournament/tiebreaks";
import { errorMessage, getStore } from "./usePhysical";
import "./physical.css";

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
  const [mode, setMode] = useState<"paste" | "single">("paste");
  const [paste, setPaste] = useState("");
  const [singles, setSingles] = useState<RosterEntry[]>([]);
  const [pName, setPName] = useState("");
  const [pRating, setPRating] = useState("");
  const [pClub, setPClub] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = STEPS[step];
  const stepNames = [t.stepName, t.stepSystem, t.stepRounds, t.stepTiebreaks, t.stepPlayers, t.stepConfirm];

  // Én kilde til sannhet for spillerne: den innlimte lista (tolket mens du skriver) pluss de som er lagt til én og én.
  const parsed = useMemo(() => parseRoster(paste), [paste]);
  const roster = useMemo<RosterEntry[]>(() => [...parsed.entries, ...singles], [parsed.entries, singles]);
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
    setSingles((x) => [...x, { name, ...(r !== undefined ? { rating: r } : {}), ...(pClub.trim() ? { club: pClub.trim() } : {}) }]);
    setPName("");
    setPRating("");
    setPClub("");
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

  function goTo(i: number) {
    setError(null);
    setStep(i);
  }
  function next() {
    setError(null);
    if (step === STEPS.length - 1) void create();
    else setStep((s) => s + 1);
  }

  const swissLike = system === "monrad" || system === "swiss";
  const rematchWarn = swissLike && roster.length >= 2 ? roundsWarning(roster.length, totalRounds) : null;
  const unusedTb = TIEBREAK_KEYS.filter((k) => !tiebreaks.includes(k));

  return (
    <main className="center-screen">
      <div className="card card-form stack scale-in">
        <PageHeader backHref="/arranger/fysisk" />
        <Stepper steps={stepNames} current={step} onStep={goTo} stepWord={no.wizard.step} ofWord={no.wizard.of} />

        {key === "name" && (
          <div className="stack gap-5">
            <div className="field">
              <label htmlFor="pn" className="wz-q">{t.nameLabel}</label>
              <input id="pn" className="input" autoFocus maxLength={80} placeholder={t.namePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <span className="wz-q" id="grp-label">{t.groupLabelLabel}</span>
              <Segmented
                aria-labelledby="grp-label"
                value={groupLabel}
                onChange={setGroupLabel}
                options={[{ value: "Klubb", label: t.groupClub }, { value: "Klasse", label: t.groupClass }]}
              />
            </div>
          </div>
        )}

        {key === "system" && (
          <div className="stack">
            <span className="wz-q" id="sys-label">{t.systemLabel}</span>
            <div className="opt-list" role="radiogroup" aria-labelledby="sys-label">
              {PHYSICAL_SYSTEMS.map((s) => (
                <label key={s} className="opt" data-checked={system === s}>
                  <input type="radio" name="system" checked={system === s} onChange={() => setSystem(s)} />
                  <span className="opt-body">
                    <span className="opt-title">
                      {t.systems[s].label}
                      {s === "monrad" && <span className="badge badge-live">{t.systemRecommended}</span>}
                    </span>
                    <span className="opt-help">{t.systems[s].help}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {key === "rounds" && (
          <div className="stack gap-5">
            {swissLike && (
              <>
                <div className="field">
                  <span className="wz-q" id="rounds-label">{t.roundsLabel}</span>
                  <div role="group" aria-labelledby="rounds-label" className="wz-center">
                    <NumberField value={rounds} onChange={setRounds} min={1} max={15} aria-label={t.roundsLabel} className="numfield-hero-wrap" hero />
                  </div>
                  <div className="tags tags-center"><span className="tag">{t.roundsHint}</span></div>
                </div>
                <label className="switch-row">
                  <input type="checkbox" role="switch" className="switch" checked={lateEntry} onChange={(e) => setLateEntry(e.target.checked)} />
                  <span className="opt-body">
                    <span className="opt-title">{t.allowLateEntry}</span>
                  </span>
                </label>
                <div className="field">
                  <span className="wz-q">
                    <span id="bye-label">{t.byePointsLabel}</span> <InfoTip align="start">{t.byeHelp}</InfoTip>
                  </span>
                  <Segmented
                    aria-labelledby="bye-label"
                    value={byeHalf ? "half" : "full"}
                    onChange={(v) => setByeHalf(v === "half")}
                    options={[{ value: "full", label: t.byeFull }, { value: "half", label: t.byeHalf }]}
                  />
                </div>
              </>
            )}
            {system === "roundRobin" && (
              <>
                <label className="switch-row">
                  <input type="checkbox" role="switch" className="switch" checked={dbl} onChange={(e) => setDbl(e.target.checked)} />
                  <span className="opt-body">
                    <span className="opt-title">{t.doubleRoundRobin}</span>
                    <span className="opt-help">{t.doubleRoundRobinHelp}</span>
                  </span>
                </label>
                <div className="tags"><span className="tag">{roster.length >= 2 ? t.roundsAuto(totalRounds) : t.roundsAutoLater}</span></div>
              </>
            )}
            {system === "knockout" && <div className="tags"><span className="tag">{roster.length >= 2 ? t.roundsAuto(totalRounds) : t.roundsAutoLater}</span></div>}
          </div>
        )}

        {key === "tiebreaks" && (
          <div className="stack gap-5">
            <div className="field">
              <h2 className="wz-q">{t.tiebreaksLabel}</h2>
              <span className="wz-help">{t.tiebreaksHint}</span>
            </div>
            <div className="field">
              <span className="sect-title">{t.tiebreaksUsed}</span>
              {tiebreaks.length === 0 && <span className="wz-help">{t.tiebreaksNone}</span>}
              <ol className="rule-list">
                {tiebreaks.map((k, i) => (
                  <li key={k} className="rule">
                    <span className="rule-no" aria-hidden="true">{i + 1}</span>
                    <span className="rule-body">
                      <b>{no.tiebreaks[k].label} <InfoTip align="start" label={no.common.aboutX(no.tiebreaks[k].label)}>{no.tiebreaks[k].help}</InfoTip></b>
                    </span>
                    <span className="rule-actions">
                      <button type="button" className="icon-btn" aria-label={t.ruleAria(no.tiebreaks[k].label, t.moveUp)} disabled={i === 0} onClick={() => moveTb(i, -1)}>
                        <Icon name="chevronUp" size={20} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={t.ruleAria(no.tiebreaks[k].label, t.moveDown)} disabled={i === tiebreaks.length - 1} onClick={() => moveTb(i, 1)}>
                        <Icon name="chevronDown" size={20} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={t.ruleAria(no.tiebreaks[k].label, t.removeRule)} onClick={() => setTiebreaks((x) => x.filter((y) => y !== k))}>
                        <Icon name="close" size={20} />
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            {unusedTb.length > 0 && (
              <div className="field">
                <span className="sect-title">{t.tiebreaksAvailable}</span>
                <ul className="rule-list">
                  {unusedTb.map((k) => (
                    <li key={k} className="rule rule-add">
                      <span className="rule-body">
                        <b>{no.tiebreaks[k].label} <InfoTip align="start" label={no.common.aboutX(no.tiebreaks[k].label)}>{no.tiebreaks[k].help}</InfoTip></b>
                      </span>
                      <button type="button" className="btn btn-sm" aria-label={t.ruleAria(no.tiebreaks[k].label, t.addRule)} onClick={() => setTiebreaks((x) => [...x, k])}>
                        <Icon name="more" size={16} /> {t.addRule}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {key === "players" && (
          <div className="stack">
            <div className="field">
              <h2 className="wz-q">{t.playersLabel}</h2>
              <Segmented
                aria-label={t.playersModeLabel}
                value={mode}
                onChange={setMode}
                options={[{ value: "paste", label: t.modePaste }, { value: "single", label: t.modeSingle }]}
              />
            </div>
            {mode === "paste" ? (
              <div className="field">
                <label htmlFor="paste">{t.pasteLabel}</label>
                <textarea id="paste" className="input wz-textarea" rows={6} placeholder={t.pastePlaceholder} value={paste} onChange={(e) => setPaste(e.target.value)} />
              </div>
            ) : (
              <div className="stack gap-3">
                <div className="pp-form">
                  <input className="input" aria-label={t.playerName} placeholder={t.playerName} value={pName} onChange={(e) => setPName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} />
                  <input className="input" inputMode="numeric" aria-label={t.playerRating} placeholder={t.playerRating} value={pRating} onChange={(e) => setPRating(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} />
                  <input className="input" aria-label={t.playerGroup} placeholder={groupLabel} value={pClub} onChange={(e) => setPClub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} />
                  <button type="button" className="btn btn-primary" onClick={addOne} disabled={!pName.trim()}>
                    <Icon name="userPlus" size={16} /> {t.addPlayer}
                  </button>
                </div>
              </div>
            )}

            <div className="field" aria-live="polite">
              <span className="sect-title">{t.previewTitle} ({t.playerCount(roster.length)})</span>
              {roster.length === 0 ? (
                <span className="wz-help">{t.previewEmpty}</span>
              ) : (
                <ol className="wz-roster">
                  {roster.map((p, i) => {
                    const singleIdx = i - parsed.entries.length;
                    return (
                      <li key={`${p.name}-${i}`} className="wz-roster-item">
                        <span className="wz-roster-no">{i + 1}</span>
                        <span className="wz-roster-name">{p.name}</span>
                        <span className="wz-roster-meta">{[p.rating, p.club].filter((x) => x !== undefined && x !== "").join(" · ")}</span>
                        {singleIdx >= 0 ? (
                          <button type="button" className="icon-btn" aria-label={`${t.removePlayer} ${p.name}`} onClick={() => setSingles((x) => x.filter((_, j) => j !== singleIdx))}>
                            <Icon name="close" size={18} />
                          </button>
                        ) : (
                          <span className="wz-roster-gap" aria-hidden="true" />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {parsed.errors.length > 0 && (
                <div className="banner banner-warn wz-issues" role="status">
                  <b>{t.previewIssues(parsed.errors.length)}</b>
                  {parsed.errors.map((e) => (
                    <span key={e.line}>{t.lineError(e.line, e.message)}</span>
                  ))}
                </div>
              )}
              {roster.length < 2 && <span className="wz-help">{t.needTwoPlayers}</span>}
            </div>
          </div>
        )}

        {key === "confirm" && (
          <div className="stack">
            <h2 className="wz-q">{t.confirmTitle}</h2>
            <dl className="sum-list">
              <SumRow label={t.rowName} value={title.trim()} onChange={() => goTo(0)} />
              <SumRow label={t.rowGroup} value={groupLabel} onChange={() => goTo(0)} />
              <SumRow label={t.rowSystem} value={t.systems[system].label} onChange={() => goTo(1)} />
              <SumRow label={t.rowRounds} value={String(totalRounds)} onChange={() => goTo(2)} />
              <SumRow label={t.rowTiebreaks} value={tiebreaks.map((k) => no.tiebreaks[k].label).join(", ") || "–"} onChange={() => goTo(3)} />
              <SumRow label={t.rowPlayers} value={t.playerCount(roster.length)} onChange={() => goTo(4)} />
            </dl>
            {rematchWarn && <div className="banner banner-warn" role="status">{rematchWarn}</div>}
          </div>
        )}

        {error && <div className="banner banner-error" role="alert">{error}</div>}

        <div className="row wz-nav">
          {step > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => goTo(step - 1)} disabled={busy}>
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

function SumRow({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  return (
    <div className="sum-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <button type="button" className="btn btn-sm btn-ghost" aria-label={no.physical.changeAria(label)} onClick={onChange}>
        <Icon name="edit" size={14} /> {no.physical.change}
      </button>
    </div>
  );
}
