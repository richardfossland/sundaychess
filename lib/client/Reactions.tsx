"use client";

// Ephemeral emoji reactions. Sent as client broadcasts on the game channel —
// never stored, never authoritative. Gated by the tournament's `reactions`
// config flag (default off) so the organizer decides if the room can handle it.

export const REACTION_EMOJIS = ["👍", "👏", "😄", "😮", "🔥"] as const;

export interface FloatingReaction {
  id: number;
  emoji: string;
  /** horizontal position, percent of layer width */
  x: number;
}

/** Overlay of floating, rising emojis. Position the parent `relative`;
 * pointer-events pass through. */
export function ReactionLayer({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="reaction-layer" aria-hidden>
      {items.map((r) => (
        <span key={r.id} className="reaction-float" style={{ left: `${r.x}%` }}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}

/** Tap-to-send emoji bar. */
export function ReactionBar({ onSend }: { onSend: (emoji: string) => void }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Send en reaksjon">
      {REACTION_EMOJIS.map((e) => (
        <button key={e} className="reaction-btn" onClick={() => onSend(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}
