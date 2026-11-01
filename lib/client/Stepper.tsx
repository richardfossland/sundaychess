"use client";

export interface StepperProps {
  /** Step names in order. */
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  /** Called when an EARLIER step is clicked. Later steps are never reachable here. */
  onStep: (index: number) => void;
  /** Label for the compact phone form, e.g. "Steg" -> "Steg 2 av 6 · Navn". */
  stepWord?: string;
  ofWord?: string;
}

/** Named wizard steps. Done steps are buttons (go back); the current step is
 * aria-current="step"; future steps are inert. On phones the list collapses to
 * "Steg 2 av 6 · Navn". */
export function Stepper({ steps, current, onStep, stepWord = "Steg", ofWord = "av" }: StepperProps) {
  return (
    <nav className="stepper" aria-label={stepWord}>
      <ol className="stepper-list">
        {steps.map((name, i) => {
          const body = (
            <>
              <span className="stepper-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="stepper-label">{name}</span>
            </>
          );
          return (
            <li key={name + i} className="stepper-item">
              {i < current ? (
                <button type="button" className="stepper-step" onClick={() => onStep(i)}>
                  {body}
                </button>
              ) : (
                <span
                  className="stepper-step"
                  aria-current={i === current ? "step" : undefined}
                  aria-disabled={i > current ? true : undefined}
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="stepper-compact">
        {stepWord} {current + 1} {ofWord} {steps.length} · {steps[current]}
      </p>
    </nav>
  );
}
