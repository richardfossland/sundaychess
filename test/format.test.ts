import { describe, expect, it } from "vitest";
import { formatDate, formatTime } from "@/lib/format";

describe("format helpers (nb-NO)", () => {
  it("formats dates the Norwegian way", () => {
    expect(formatDate("2026-11-05T12:00:00Z", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })).toBe("5. november 2026");
    expect(formatDate("2026-11-05T12:00:00Z", { timeZone: "UTC" })).toBe("5.11.2026");
  });
  it("accepts Date, returns empty string for invalid input", () => {
    expect(formatDate(new Date("2026-01-02T12:00:00Z"), { timeZone: "UTC" })).toBe("2.1.2026");
    expect(formatDate("nope")).toBe("");
    expect(formatTime("nope")).toBe("");
  });
  it("formats 24-hour time", () => {
    expect(formatTime("2026-11-05T15:04:00Z", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })).toBe("15:04");
  });
});
