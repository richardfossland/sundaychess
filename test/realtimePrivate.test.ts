import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { channelConfig } from "@/lib/supabase/channelRegistry";
import { channels } from "@/lib/realtime";
import { broadcastMessages, LEGACY_PUBLIC_COPY } from "@/lib/server/broadcast";

// The seam between client topics, server sends and migration 0014: topic shapes
// must be exactly the ones chess_rt_topic_ok accepts, or private subscribes fail
// with "Unauthorized" in prod while every unit test is green.
const ID = "11111111-2222-4333-8444-555555555555";
const sql = readFileSync(
  join(__dirname, "..", "supabase", "migrations", "0014_realtime_private.sql"),
  "utf8",
);
const res = [...sql.matchAll(/p_topic ~\* '([^']+)'/g)].map((m) => new RegExp(m[1], "i"));

describe("private realtime channels", () => {
  it("every topic shape matches a 0014 regex", () => {
    for (const t of [
      channels.lobby(ID),
      channels.spectate(ID),
      channels.presence(ID),
      channels.game(ID),
    ]) {
      expect(res.some((r) => r.test(t))).toBe(true);
    }
  });

  it("clients subscribe privately", () => {
    expect(channelConfig("k").config.private).toBe(true);
    expect(channelConfig("k").config.presence.key).toBe("k");
  });

  it("server sends the private message first, plus the legacy public copy while on", () => {
    const msgs = broadcastMessages(channels.lobby(ID), "roster", { a: 1 });
    expect(msgs[0]).toEqual({ topic: `chess:lobby:${ID}`, event: "roster", payload: { a: 1 }, private: true });
    expect(msgs).toHaveLength(LEGACY_PUBLIC_COPY ? 2 : 1);
    expect(LEGACY_PUBLIC_COPY).toBe(true);
    expect(broadcastMessages("t", "e", {}, false)).toHaveLength(1);
    expect(broadcastMessages("t", "e", {}, true)[1].private).toBe(false);
  });
});
