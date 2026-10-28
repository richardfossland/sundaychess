import { describe, expect, it } from "vitest";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce, replay } from "@/lib/physical/reducer";
import type { PhysicalEvent } from "@/lib/physical/schema";

function bigLog(players: number, total: number): PhysicalEvent[] {
  const t = createTournament({
    id: "11111111-2222-4333-8444-555555555555",
    title: "Stor",
    settings: { system: "monrad", rounds: 5, tiebreaks: [], byePoints: 1, allowLateEntry: false },
  });
  const events = [...t.events];
  for (let i = 0; i < players; i++) events.push(makeEvent({ type: "addPlayer", playerId: `p${i}`, name: `Spiller ${i}` }));
  for (let i = events.length; i < total; i++) events.push(makeEvent({ type: "editPlayer", playerId: `p${i % players}`, patch: { club: `K${i}` } }));
  return events;
}

describe("replay er O(n)", () => {
  it("5 000 hendelser spilles av på under 300 ms", () => {
    const log = bigLog(500, 5000);
    const t0 = performance.now();
    const t = replay(log);
    const ms = performance.now() - t0;
    expect(t.players).toHaveLength(500);
    expect(t.events).toHaveLength(5000);
    expect(ms).toBeLessThan(300);
  });

  it("muterer ikke inndata, og reduce er fortsatt ren", () => {
    const log = bigLog(5, 20);
    const frozen = JSON.stringify(log);
    const a = replay(log);
    expect(JSON.stringify(log)).toBe(frozen);
    expect(a.events).not.toBe(log);
    const before = JSON.stringify(a);
    const b = reduce(a, makeEvent({ type: "addPlayer", playerId: "x", name: "Ny" }));
    expect(JSON.stringify(a)).toBe(before);
    expect(b.players).toHaveLength(6);
    expect(() => reduce(a, a.events[3])).toThrow(); // duplikat-id
  });
});
