"use client";

import type { ReactNode } from "react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface Props<T extends string | number> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name of the group (use when there is no visible label). */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
}

/** Single-choice button group. role="radiogroup" with roving tabindex and
 * arrow-key navigation, so it behaves like native radio buttons. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  ...aria
}: Props<T>) {
  const enabled = options.filter((o) => !o.disabled);
  const move = (dir: 1 | -1) => {
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      className={className ? `seg ${className}` : "seg"}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
      {...aria}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (!enabled.some((x) => x.value === value) && o === enabled[0]) ? 0 : -1}
            disabled={o.disabled}
            className="seg-btn"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
