import { describe, expect, it } from "vitest";
import { computeTeamStandings } from "@/lib/tournament/teams";

describe("computeTeamStandings", () => {
  it("sums member scores per team, sorted descending", () => {
    const rows = computeTeamStandings(
      ["Rød", "Blå"],
      [
        { team: "Rød", score: 2 },
        { team: "Rød", score: 1.5 },
        { team: "Blå", score: 3 },
        { team: "Blå", score: 1 },
      ],
    );
    expect(rows).toEqual([
      { team: "Blå", score: 4, players: 2 },
      { team: "Rød", score: 3.5, players: 2 },
    ]);
  });

  it("ignores teamless players and unknown teams", () => {
    const rows = computeTeamStandings(
      ["Rød", "Blå"],
      [
        { team: null, score: 5 },
        { team: "Lilla", score: 5 },
        { team: "Rød", score: 1 },
      ],
    );
    expect(rows[0]).toEqual({ team: "Rød", score: 1, players: 1 });
    expect(rows[1]).toEqual({ team: "Blå", score: 0, players: 0 });
  });

  it("returns empty when teams are not configured", () => {
    expect(computeTeamStandings([], [{ team: "Rød", score: 1 }])).toEqual([]);
  });

  it("breaks score ties alphabetically for a stable display", () => {
    const rows = computeTeamStandings(
      ["Gul", "Blå"],
      [
        { team: "Gul", score: 2 },
        { team: "Blå", score: 2 },
      ],
    );
    expect(rows.map((r) => r.team)).toEqual(["Blå", "Gul"]);
  });
});
