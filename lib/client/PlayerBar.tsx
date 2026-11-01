"use client";

import type { ReactNode } from "react";
import { CapturedPieces } from "@/lib/client/CapturedPieces";
import { ChessClock } from "@/lib/client/ChessClock";

/** Brikkefarge-merke: ♔/♚ på hvit/svart flate. Teksten skjules på smal mobil. */
export function ColorChip({ color, label }: { color: "white" | "black"; label: string }) {
  return (
    <span className={`color-chip color-chip-${color}`}>
      <span className="color-chip-glyph">{color === "white" ? "♔" : "♚"}</span>
      <span className="color-chip-label">{label}</span>
    </span>
  );
}

export interface PlayerBarProps {
  name: string;
  color: "white" | "black";
  colorLabel: string;
  /** Avatar-innhold (initial eller ikon). `me` gir gullavatar, ellers blekk. */
  avatar: ReactNode;
  me?: boolean;
  /** Brettets stilling og brikkefarge å vise slåtte brikker for. */
  fen: string;
  baselineFen?: string;
  /** Er det denne spillerens tur? */
  active: boolean;
  clock?: { ms: number; at: number; running: boolean } | null;
  testId?: string;
}

/** Én spillerlinje over/under brettet: avatar, navn, farge, slåtte brikker,
 * klokke og tur-prikk. Samme høyde med og uten klokke og slåtte brikker, så
 * brettet aldri flytter seg (L2). */
export function PlayerBar({
  name,
  color,
  colorLabel,
  avatar,
  me,
  fen,
  baselineFen,
  active,
  clock,
  testId,
}: PlayerBarProps) {
  return (
    <div className={`pbar ${active ? "is-active" : ""}`} data-testid={testId}>
      <span className={`avatar-lg ${me ? "" : "avatar-ink"}`}>{avatar}</span>
      <div className="pbar-id">
        <span className="pbar-name">{name}</span>
        {colorLabel && <ColorChip color={color} label={colorLabel} />}
      </div>
      <CapturedPieces fen={fen} side={color} baselineFen={baselineFen} />
      <span className="pbar-spacer" />
      {clock && <ChessClock ms={clock.ms} at={clock.at} running={clock.running} />}
      <span className={`pbar-dot ${active ? "is-on" : ""}`} />
    </div>
  );
}
