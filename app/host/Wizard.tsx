"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { no } from "@/lib/locale/no";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import type { TournamentConfig } from "@/lib/types";

type StepKey =
  | "title"
  | "rounds"
  | "variant"
  | "playoff"
  | "size"
  | "timer"
  | "clock"
  | "reactions"
  | "teams"
  | "review";

type VariantKey = "standard" | "no_queens" | "pawn_war";

export const TEAM_NAMES = ["Rød", "Blå", "Grønn", "Gul"] as const;

export function Wizard({ onExit }: { onExit?: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
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

  // The 'size' step only exists when a playoff is enabled.
  const steps = useMemo<StepKey[]>(
    () =>
      playoff
        ? ["title", "rounds", "variant", "playoff", "size", "timer", "clock", "reactions", "teams", "review"]
        : ["title", "rounds", "variant", "playoff", "timer", "clock", "reactions", "teams", "review"],
    [playoff],
  );
  const key = steps[Math.min(step, steps.length - 1)];
  const isLast = step >= steps.length - 1;

  function next() {
    setError(null);
    if (isLast) void create();
    else setStep((s) => Math.min(s + 1, steps.length - 1));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function create() {
    setBusy(true);
    setError(null);
    const config: TournamentConfig = {
      leagueRounds,
      playoff,
      playoffSize: playoff ? playoffSize : 0,
      roundTimerSec: timerMin === 0 ? null : timerMin * 60,
      reactions,
      variant,
      clockSec: clockMin === 0 ? null : clockMin * 60,
      teams: teamCount === 0 ? [] : TEAM_NAMES.slice(0, teamCount) as unknown as string[],
    };
    try {
      const t = await api.createTournament({ title: title.trim(), config });
      identity.saveHostCode(t.id, t.hostCode);
      router.push(`/host/${t.id}`);
    } catch {
      setError(no.common.error);
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <p className="eyebrow">
          {no.wizard.step} {step + 1} {no.wizard.of} {steps.length}
        </p>
        <div className="row" style={{ gap: 6 }}>
          {steps.map((s, i) => (
            <span
              key={s}
              style={{
                width: 22,
                height: 4,
                borderRadius: 4,
                background: i <= step ? "var(--gold)" : "var(--ink-soft)",
              }}
            />
          ))}
        </div>
      </div>

      {key === "title" && (
        <div className="field">
          <label htmlFor="wt">{no.wizard.titleStep}</label>
          <input
            id="wt"
            className="input"
            autoFocus
            placeholder={no.wizard.titlePlaceholder}
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {no.wizard.titleHint}
          </span>
        </div>
      )}

      {key === "rounds" && (
        <div className="stack">
          <label className="field" style={{ gap: 4 }}>
            {no.wizard.roundsStep}
          </label>
          <div className="row" style={{ justifyContent: "center", gap: 18 }}>
            <button
              className="btn"
              onClick={() => setLeagueRounds((r) => Math.max(3, r - 1))}
              aria-label="færre"
            >
              −
            </button>
            <span className="pin-hero" style={{ fontSize: 64 }}>
              {leagueRounds}
            </span>
            <button
              className="btn"
              onClick={() => setLeagueRounds((r) => Math.min(7, r + 1))}
              aria-label="flere"
            >
              +
            </button>
          </div>
          <input
            type="range"
            min={3}
            max={7}
            value={leagueRounds}
            onChange={(e) => setLeagueRounds(Number(e.target.value))}
          />
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.roundsHint}
          </span>
        </div>
      )}

      {key === "variant" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.variantStep}
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {(["standard", "no_queens", "pawn_war"] as const).map((v) => (
              <button
                key={v}
                className={`btn btn-block ${variant === v ? "btn-primary" : "btn-ghost"}`}
                style={{ textAlign: "left", padding: "12px 16px" }}
                onClick={() => setVariant(v)}
              >
                <b>{no.wizard.variants[v]}</b>
                <span
                  style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}
                >
                  {no.wizard.variants[`${v}Sub`]}
                </span>
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.variantHint}
          </span>
        </div>
      )}

      {key === "playoff" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.playoffStep}
          </p>
          <div className="row">
            <button
              className={`btn grow btn-lg ${!playoff ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setPlayoff(false)}
            >
              {no.wizard.playoffOff}
            </button>
            <button
              className={`btn grow btn-lg ${playoff ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setPlayoff(true)}
            >
              {no.wizard.playoffOn}
            </button>
          </div>
        </div>
      )}

      {key === "size" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.playoffSizeStep}
          </p>
          <div className="row">
            {([4, 8, 16] as const).map((n) => (
              <button
                key={n}
                className={`btn grow btn-lg ${playoffSize === n ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPlayoffSize(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.playoffSizeHint}
          </span>
        </div>
      )}

      {key === "timer" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.timerStep}
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {([0, 5, 10, 15] as const).map((m) => (
              <button
                key={m}
                className={`btn grow btn-lg ${timerMin === m ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTimerMin(m)}
              >
                {m === 0 ? no.wizard.timerOff : `${m} ${no.wizard.min}`}
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.timerHint}
          </span>
        </div>
      )}

      {key === "clock" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.clockStep}
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {([0, 3, 5, 10] as const).map((m) => (
              <button
                key={m}
                className={`btn grow btn-lg ${clockMin === m ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setClockMin(m)}
              >
                {m === 0 ? no.wizard.clockOff : `⏱ ${m} ${no.wizard.min}`}
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.clockHint}
          </span>
        </div>
      )}

      {key === "teams" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.teamsStep}
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {([0, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                className={`btn grow btn-lg ${teamCount === n ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTeamCount(n)}
              >
                {n === 0 ? no.wizard.teamsOff : `${n} lag`}
              </button>
            ))}
          </div>
          {teamCount > 0 && (
            <p className="text-center" style={{ fontSize: 14 }}>
              {TEAM_NAMES.slice(0, teamCount).join(" · ")}
            </p>
          )}
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.teamsHint}
          </span>
        </div>
      )}

      {key === "reactions" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.reactionsStep}
          </p>
          <div className="row">
            <button
              className={`btn grow btn-lg ${!reactions ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setReactions(false)}
            >
              {no.wizard.reactionsOff}
            </button>
            <button
              className={`btn grow btn-lg ${reactions ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setReactions(true)}
            >
              👍😄🔥 {no.wizard.reactionsOn}
            </button>
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.reactionsHint}
          </span>
        </div>
      )}

      {key === "review" && (
        <div className="stack">
          <p className="eyebrow">{no.wizard.reviewStep}</p>
          {title.trim() && (
            <div className="spread">
              <span className="muted">{no.wizard.titleStep}</span>
              <b>{title.trim()}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewRounds}</span>
            <b>{leagueRounds}</b>
          </div>
          {variant !== "standard" && (
            <div className="spread">
              <span className="muted">{no.wizard.reviewVariant}</span>
              <b>{no.wizard.variants[variant]}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewPlayoff}</span>
            <b>{playoff ? `${playoffSize}` : no.wizard.none}</b>
          </div>
          <div className="spread">
            <span className="muted">{no.wizard.reviewTimer}</span>
            <b>{timerMin === 0 ? no.wizard.none : `${timerMin} ${no.wizard.min}`}</b>
          </div>
          {clockMin > 0 && (
            <div className="spread">
              <span className="muted">{no.wizard.reviewClock}</span>
              <b>⏱ {clockMin} {no.wizard.min}</b>
            </div>
          )}
          {teamCount > 0 && (
            <div className="spread">
              <span className="muted">{no.wizard.reviewTeams}</span>
              <b>{TEAM_NAMES.slice(0, teamCount).join(", ")}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewReactions}</span>
            <b>{reactions ? no.wizard.reactionsOn : no.wizard.reactionsOff}</b>
          </div>
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      <div className="row" style={{ marginTop: 8 }}>
        {/* Step 0 back returns to the chooser (onExit); later steps go back a
            step. Single back button → no accidental progress reset. */}
        {(step > 0 || onExit) && (
          <button
            className="btn btn-ghost"
            onClick={step > 0 ? back : onExit}
            disabled={busy}
          >
            ← {no.common.back}
          </button>
        )}
        <button className="btn btn-primary grow" onClick={next} disabled={busy}>
          {busy ? <span className="spin" /> : isLast ? no.common.create : no.common.next}
        </button>
      </div>
    </div>
  );
}
