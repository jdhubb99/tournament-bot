import { describe, expect, it } from "bun:test";
import { checkReport, describeSeries, seriesState, winsNeeded } from "./series.ts";

const p1Win = { p1_score: 3, p2_score: 1 };
const p2Win = { p1_score: 0, p2_score: 2 };

describe("winsNeeded", () => {
  it("is a majority of best_of", () => {
    expect([1, 3, 5].map(winsNeeded)).toEqual([1, 2, 3]);
  });
});

describe("seriesState", () => {
  it("decides a Bo1 on the first game", () => {
    expect(seriesState([p2Win], 1)).toEqual({ p1Wins: 0, p2Wins: 1, winsNeeded: 1, winner: "p2" });
  });

  it("keeps a Bo3 open at 1–1 and decides it at 2–1", () => {
    expect(seriesState([p1Win, p2Win], 3).winner).toBeNull();
    expect(seriesState([p1Win, p2Win, p1Win], 3)).toEqual({ p1Wins: 2, p2Wins: 1, winsNeeded: 2, winner: "p1" });
  });

  it("needs three wins in a Bo5", () => {
    expect(seriesState([p2Win, p2Win], 5).winner).toBeNull();
    expect(seriesState([p2Win, p2Win, p2Win], 5).winner).toBe("p2");
  });

  it("starts at 0–0 with no winner", () => {
    expect(seriesState([], 3)).toEqual({ p1Wins: 0, p2Wins: 0, winsNeeded: 2, winner: null });
  });
});

describe("checkReport", () => {
  const players = { p1: "a", p2: "b" };

  it("maps winner/loser scores onto p1/p2", () => {
    expect(checkReport(players, "a", 3, 1)).toEqual({ ok: true, p1Score: 3, p2Score: 1 });
    expect(checkReport(players, "b", 4, 2)).toEqual({ ok: true, p1Score: 2, p2Score: 4 });
  });

  it("rejects a winner who isn't in the match", () => {
    expect(checkReport(players, "c", 3, 1)).toEqual({ ok: false, reason: "not_in_match" });
  });

  it("rejects ties and a winner with fewer goals", () => {
    expect(checkReport(players, "a", 2, 2)).toEqual({ ok: false, reason: "not_higher" });
    expect(checkReport(players, "a", 1, 2)).toEqual({ ok: false, reason: "not_higher" });
  });

  it("rejects negative or fractional scores", () => {
    expect(checkReport(players, "a", 3, -1)).toEqual({ ok: false, reason: "negative" });
    expect(checkReport(players, "a", -1, -2)).toEqual({ ok: false, reason: "negative" });
    expect(checkReport(players, "a", 2.5, 1)).toEqual({ ok: false, reason: "negative" });
    expect(checkReport(players, "a", 2, 0.5)).toEqual({ ok: false, reason: "negative" });
  });
});

describe("describeSeries", () => {
  const state = (p1Wins: number, p2Wins: number, winner: "p1" | "p2" | null = null) => ({
    p1Wins,
    p2Wins,
    winsNeeded: 2,
    winner,
  });

  it("names the leader with their wins first", () => {
    expect(describeSeries(state(2, 1), "Jake", "Benny")).toBe("Jake leads the series 2–1");
    expect(describeSeries(state(0, 1), "Jake", "Benny")).toBe("Benny leads the series 1–0");
  });

  it("calls a tie", () => {
    expect(describeSeries(state(1, 1), "Jake", "Benny")).toBe("Series tied 1–1");
  });

  it("names the series winner", () => {
    expect(describeSeries(state(1, 2, "p2"), "Jake", "Benny")).toBe("Benny wins the series 2–1");
    expect(describeSeries(state(1, 0, "p1"), "Jake", "Benny")).toBe("Jake wins the series 1–0");
  });
});
