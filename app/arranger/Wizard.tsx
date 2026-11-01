"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { no } from "@/lib/locale/no";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { MAX_ROUNDS, MIN_ROUNDS } from "@/lib/tournament/roundsAdvice";
import type { TournamentConfig } from "@/lib/types";
import { Icon } from "@/lib/client/Icon";
import { NumberField } from "@/lib/client/NumberField";
import { Segmented } from "@/lib/client/Segmented";
import { Stepper } from "@/lib/client/Stepper";

type StepKey = "name" | "format" | "rules" | "extras" | "review";
const STEPS: readonly StepKey[] = ["name", "format", "rules", "extras", "review"];

type VariantKey = "standard" | "no_queens" | "pawn_war";

export const TEAM_NAMES = ["Rød", "Blå", "Grønn", "Gul"] as const;

/** The wizard's out-of-the-box defaults — same values the "rounds" step's
 * useState initializers use below. Extracted so "Rask start" (page.tsx) can
 * create a tournament with these without walking the wizard at all. */
export function defaultConfig(title: string): { title: string; config: TournamentConfig } {
  return {
    title: title.trim(),
    config: {
      format: "league",
      leagueRounds: 5,
      playoff: false,
      playoffSize: 0,
      roundTimerSec: null,
      reactions: false,
      variant: "standard",
      clockSec: null,
      teams: [],
    },
  };
}

/** Same cap the config route enforces server-side (app/api/tournament/[id]/
 * config/route.ts and app/api/tournament/route.ts) — kept here too so the
 * textarea's own counter can't drift from what actually gets saved. */
export const MAX_NOTES = 280;

export function Wizard({ onExit }: { onExit?: () => void }) {
  const router = useRouter();
  const t = no.wizard;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [format, setFormat] = useState<"league" | "cup">("league");
  const [leagueRounds, setLeagueRounds] = useState(5);
  const [variant, setVariant] = useState<VariantKey>("standard");
  const [playoff, setPlayoff] = useState(false);
  const [playoffSize, setPlayoffSize] = useState<4 | 8 | 16>(8);
  const [timerMin, setTimerMin] = useState<0 | 5 | 10 | 15>(0);
  const [clockMin, setClockMin] = useState<0 | 3 | 5 | 10>(0);
  const [reactions, setReactions] = useState(false);
  const [teamCount, setTeamCount] = useState<0 | 2 | 3 | 4>(0);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = STEPS[step];
  const isLast = step >= STEPS.length - 1;
  const stepNames = [t.stepName, t.stepFormat, t.stepRules, t.stepExtras, t.reviewStep];
  const cup = format === "cup";

  function goTo(i: number) {
    setError(null);
    setStep(i);
  }
  function next() {
    setError(null);
    if (isLast) void create();
    else setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function create() {
    setBusy(true);
    setError(null);
    const trimmedNotes = notes.trim().slice(0, MAX_NOTES);
    const config: TournamentConfig = {
      format,
      leagueRounds,
      playoff: cup ? true : playoff,
      playoffSize: cup ? 16 : playoff ? playoffSize : 0,
      roundTimerSec: timerMin === 0 ? null : timerMin * 60,
      reactions,
      variant,
      clockSec: clockMin === 0 ? null : clockMin * 60,
      teams: teamCount === 0 ? [] : TEAM_NAMES.slice(0, teamCount) as unknown as string[],
      ...(trimmedNotes ? { notes: trimmedNotes } : {}),
    };
    try {
      const created = await api.createTournament({ title: title.trim(), config });
      identity.saveHostCode(created.id, created.hostCode);
      router.push(`/host/${created.id}`);
    } catch {
      setError(no.common.error);
      setBusy(false);
    }
  }

  const timerOptions = ([0, 5, 10, 15] as const).map((m) => ({
    value: m,
    label: m === 0 ? t.timerOff : `${m} ${t.min}`,
  }));
  const clockOptions = ([0, 3, 5, 10] as const).map((m) => ({
    value: m,
    label: m === 0 ? t.clockOff : `${m} ${t.min}`,
  }));
  const teamOptions = ([0, 2, 3, 4] as const).map((n) => ({
    value: n,
    label: n === 0 ? t.teamsOff : `${n} lag`,
  }));

  return (
    <div className="stack">
      <Stepper steps={stepNames} current={step} onStep={goTo} stepWord={t.step} ofWord={t.of} />

      {key === "name" && (
        <div className="stack gap-5">
          <div className="field">
            <label htmlFor="wt" className="wz-q">{t.titleStep}</label>
            <input
              id="wt"
              className="input"
              autoFocus
              placeholder={t.titlePlaceholder}
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="wz-help">{t.titleHint}</span>
          </div>
          {/* Private note-to-self — optional, ≤280 chars, NEVER shown to
              students (see lib/dto.ts's toBoardTournament). */}
          <div className="field">
            <label htmlFor="wn" className="wz-q">{t.notesLabel}</label>
            <textarea
              id="wn"
              className="input wz-textarea"
              rows={3}
              maxLength={MAX_NOTES}
              placeholder={t.notesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="wz-help notes-count">
              {notes.length} / {MAX_NOTES}
            </span>
          </div>
        </div>
      )}

      {key === "format" && (
        <div className="stack gap-5">
          <div className="field">
            <span className="wz-q" id="fmt-label">{t.formatStep}</span>
            <div className="opt-list" role="radiogroup" aria-labelledby="fmt-label">
              {(["league", "cup"] as const).map((f) => (
                <label key={f} className="opt" data-checked={format === f}>
                  <input type="radio" name="format" checked={format === f} onChange={() => setFormat(f)} />
                  <span className="opt-body">
                    <span className="opt-title">
                      <Icon name={f === "league" ? "league" : "cup"} size={16} />{" "}
                      {f === "league" ? t.formatLeague : t.formatCup}
                    </span>
                    <span className="opt-help">{f === "league" ? t.formatLeagueSub : t.formatCupSub}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!cup && (
            <>
              <div className="field">
                <span className="wz-q" id="rounds-label">{t.roundsStep}</span>
                <div role="group" aria-labelledby="rounds-label" className="wz-center">
                  <NumberField
                    value={leagueRounds}
                    onChange={setLeagueRounds}
                    min={MIN_ROUNDS}
                    max={MAX_ROUNDS}
                    aria-label={t.roundsStep}
                    className="numfield-hero-wrap"
                    hero
                  />
                </div>
                <span className="wz-help">
                  {t.roundsHint}. {t.roundsRuleOfThumb}.
                </span>
              </div>

              <div className="field">
                <span className="wz-q" id="po-label">{t.playoffStep}</span>
                <Segmented
                  aria-labelledby="po-label"
                  value={playoff ? "on" : "off"}
                  onChange={(v) => setPlayoff(v === "on")}
                  options={[
                    { value: "off", label: t.playoffOff },
                    { value: "on", label: t.playoffOn },
                  ]}
                />
              </div>

              {playoff && (
                <div className="field">
                  <span className="wz-q" id="posize-label">{t.playoffSizeStep}</span>
                  <Segmented
                    aria-labelledby="posize-label"
                    value={playoffSize}
                    onChange={setPlayoffSize}
                    options={[
                      { value: 4, label: "4" },
                      { value: 8, label: "8" },
                      { value: 16, label: "16" },
                    ]}
                  />
                  <span className="wz-help">{t.playoffSizeHint}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {key === "rules" && (
        <div className="stack gap-5">
          <div className="field">
            <span className="wz-q" id="var-label">{t.variantStep}</span>
            <div className="opt-list" role="radiogroup" aria-labelledby="var-label">
              {(["standard", "no_queens", "pawn_war"] as const).map((v) => (
                <label key={v} className="opt" data-checked={variant === v}>
                  <input type="radio" name="variant" checked={variant === v} onChange={() => setVariant(v)} />
                  <span className="opt-body">
                    <span className="opt-title">{t.variants[v]}</span>
                    <span className="opt-help">{t.variants[`${v}Sub`]}</span>
                  </span>
                </label>
              ))}
            </div>
            <span className="wz-help">{t.variantHint}</span>
          </div>

          <div className="field">
            <span className="wz-q" id="timer-label">{t.timerStep}</span>
            <Segmented aria-labelledby="timer-label" value={timerMin} onChange={setTimerMin} options={timerOptions} />
            <span className="wz-help">{t.timerHint}</span>
          </div>

          <div className="field">
            <span className="wz-q" id="clock-label">{t.clockStep}</span>
            <Segmented aria-labelledby="clock-label" value={clockMin} onChange={setClockMin} options={clockOptions} />
            <span className="wz-help">{t.clockHint}</span>
          </div>
        </div>
      )}

      {key === "extras" && (
        <div className="stack gap-5">
          <div className="field">
            <span className="wz-q" id="teams-label">{t.teamsStep}</span>
            <Segmented aria-labelledby="teams-label" value={teamCount} onChange={setTeamCount} options={teamOptions} />
            {teamCount > 0 && <span className="wz-help">{TEAM_NAMES.slice(0, teamCount).join(" · ")}</span>}
            <span className="wz-help">{t.teamsHint}</span>
          </div>

          <div className="field">
            <span className="wz-q" id="react-label">{t.reactionsStep}</span>
            <Segmented
              aria-labelledby="react-label"
              value={reactions ? "on" : "off"}
              onChange={(v) => setReactions(v === "on")}
              options={[
                { value: "off", label: t.reactionsOff },
                { value: "on", label: <><Icon name="thumbsUp" size={16} /> {t.reactionsOn}</> },
              ]}
            />
            <span className="wz-help">{t.reactionsHint}</span>
          </div>
        </div>
      )}

      {key === "review" && (
        <div className="stack">
          <h2 className="wz-q">{t.reviewStep}</h2>
          <dl className="sum-list">
            <SumRow label={t.titleStep} value={title.trim() || "–"} onChange={() => goTo(0)} />
            {notes.trim() && <SumRow label={t.reviewNotes} value={notes.trim()} onChange={() => goTo(0)} />}
            <SumRow label={t.reviewFormat} value={cup ? t.formatCup : t.formatLeague} onChange={() => goTo(1)} />
            {!cup && <SumRow label={t.reviewRounds} value={String(leagueRounds)} onChange={() => goTo(1)} />}
            {!cup && (
              <SumRow
                label={t.reviewPlayoff}
                value={playoff ? `${playoffSize}` : t.none}
                onChange={() => goTo(1)}
              />
            )}
            <SumRow label={t.reviewVariant} value={t.variants[variant]} onChange={() => goTo(2)} />
            <SumRow
              label={t.reviewTimer}
              value={timerMin === 0 ? t.none : `${timerMin} ${t.min}`}
              onChange={() => goTo(2)}
            />
            <SumRow
              label={t.reviewClock}
              value={clockMin === 0 ? t.none : `${clockMin} ${t.min}`}
              onChange={() => goTo(2)}
            />
            <SumRow
              label={t.reviewTeams}
              value={teamCount === 0 ? t.none : TEAM_NAMES.slice(0, teamCount).join(", ")}
              onChange={() => goTo(3)}
            />
            <SumRow
              label={t.reviewReactions}
              value={reactions ? t.reactionsOn : t.reactionsOff}
              onChange={() => goTo(3)}
            />
          </dl>
        </div>
      )}

      {error && <div className="banner banner-error" role="alert">{error}</div>}

      <div className="row wz-nav">
        {/* Step 0 back returns to the chooser (onExit); later steps go back a
            step. Single back button → no accidental progress reset. */}
        {(step > 0 || onExit) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={step > 0 ? () => goTo(step - 1) : onExit}
            disabled={busy}
          >
            <Icon name="back" size={16} /> {no.common.back}
          </button>
        )}
        <button type="button" className="btn btn-primary grow" onClick={next} disabled={busy}>
          {busy ? <span className="spin" /> : isLast ? no.common.create : no.common.next}
        </button>
      </div>
    </div>
  );
}

/** One row in the review step: label, current value and an "Endre" button that
 * jumps straight back to the step that sets it. */
function SumRow({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  return (
    <div className="sum-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label={`${no.wizard.edit} ${label}`}
        onClick={onChange}
      >
        <Icon name="edit" size={14} /> {no.wizard.edit}
      </button>
    </div>
  );
}
