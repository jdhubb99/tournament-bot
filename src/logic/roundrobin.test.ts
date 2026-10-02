import { describe, expect, it } from "bun:test";
import { circleRounds, orderWithoutBackToBack, roundRobinPlan, standings, type LeagueResult, type Pair } from "./roundrobin.ts";

const key = ([a, b]: Pair) => [a, b].sort().join("-");
const allPairs = (players: string[]) =>
  players.flatMap((a, i) => players.slice(i + 1).map((b) => [a, b].sort().join("-"))).sort();
const backToBacks = (pairs: readonly Pair[]) =>
  pairs.slice(1).filter((p, i) => p.some((id) => pairs[i]!.includes(id))).length;

describe("circleRounds", () => {
  it("pairs everyone once with a bye per round for 5 players", () => {
    const rounds = circleRounds(["a", "b", "c", "d", "e"]);
    expect(rounds).toHaveLength(5);
    expect(rounds.every((r) => r.length === 2)).toBe(true);
    expect(rounds.flat().map(key).sort()).toEqual(allPairs(["a", "b", "c", "d", "e"]));
    // Nobody plays twice in a round.
    for (const round of rounds) expect(new Set(round.flat()).size).toBe(4);
  });

  it("handles even counts without a bye", () => {
    const rounds = circleRounds(["a", "b", "c", "d"]);
    expect(rounds).toHaveLength(3);
    expect(rounds.flat().map(key).sort()).toEqual(allPairs(["a", "b", "c", "d"]));
  });
});

describe("orderWithoutBackToBack", () => {
  it("finds an order with no back-to-backs for 5 players", () => {
    const ordered = orderWithoutBackToBack(circleRounds(["a", "b", "c", "d", "e"]).flat());
    expect(ordered).toHaveLength(10);
    expect(backToBacks(ordered)).toBe(0);
  });

  it("keeps back-to-backs to the minimum when some are unavoidable", () => {
    // In a group of 3 every match shares a player with every other, so 2 is the minimum.
    expect(backToBacks(orderWithoutBackToBack(circleRounds(["a", "b", "c"]).flat()))).toBe(2);
    // A group of 4 can do better than the circle method's own order.
    const four = circleRounds(["a", "b", "c", "d"]).flat();
    expect(backToBacks(orderWithoutBackToBack(four))).toBeLessThanOrEqual(backToBacks(four));
  });
});

describe("roundRobinPlan", () => {
  it("has 10 best-of-1 league matches and an empty final at play order 11", () => {
    const plan = roundRobinPlan(["a", "b", "c", "d", "e"], 3);
    expect(plan).toHaveLength(11);
    expect(plan.slice(0, 10).map((m) => m.label)).toEqual([...Array(10)].map((_, i) => `Match ${i + 1}`));
    expect(plan.slice(0, 10).every((m) => m.bestOf === 1 && m.round === 1 && m.next === null)).toBe(true);
    expect(plan.slice(0, 10).map((m) => key([m.p1!, m.p2!])).sort()).toEqual(allPairs(["a", "b", "c", "d", "e"]));
    expect(plan[10]).toEqual({ round: 2, playOrder: 11, label: "Final", p1: null, p2: null, bestOf: 3, next: null });
    expect(plan.map((m) => m.playOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("standings", () => {
  const win = (winner: string, loser: string, w = 3, l = 1): LeagueResult => ({
    p1: winner,
    p2: loser,
    winner,
    games: [{ p1_score: w, p2_score: l }],
  });

  it("counts wins, games and goals from both sides", () => {
    const table = standings(["a", "b"], [{ p1: "a", p2: "b", winner: "b", games: [{ p1_score: 1, p2_score: 4 }] }]);
    expect(table).toEqual([
      { playerId: "b", played: 1, wins: 1, losses: 0, gameWins: 1, gameLosses: 0, goalsFor: 4, goalsAgainst: 1 },
      { playerId: "a", played: 1, wins: 0, losses: 1, gameWins: 0, gameLosses: 1, goalsFor: 1, goalsAgainst: 4 },
    ]);
  });

  it("ranks by wins first", () => {
    const table = standings(["a", "b", "c"], [win("c", "a"), win("c", "b"), win("b", "a")]);
    expect(table.map((r) => r.playerId)).toEqual(["c", "b", "a"]);
  });

  it("uses game wins when series wins are tied", () => {
    const series = (winner: string, loser: string, games: [number, number][]): LeagueResult => ({
      p1: winner,
      p2: loser,
      winner,
      games: games.map(([p1_score, p2_score]) => ({ p1_score, p2_score })),
    });
    // Everyone wins one series. b wins the most games (3) despite a worse goal difference than a.
    const table = standings(["a", "b", "c"], [
      series("a", "b", [[5, 0], [0, 1], [5, 0]]),
      series("b", "c", [[1, 0], [1, 0]]),
      series("c", "a", [[1, 0], [1, 0]]),
    ]);
    expect(table.map((r) => [r.playerId, r.wins, r.gameWins])).toEqual([
      ["b", 1, 3],
      ["a", 1, 2],
      ["c", 1, 2],
    ]);
  });

  it("uses goal difference after wins", () => {
    // a, b and c each win once; c has the best goal difference, then b, then a.
    const table = standings(["a", "b", "c"], [win("a", "b", 2, 1), win("b", "c", 2, 1), win("c", "a", 6, 0)]);
    expect(table.map((r) => r.playerId)).toEqual(["c", "b", "a"]);
  });

  it("puts the head-to-head winner first when two players are otherwise level", () => {
    // a and b both finish with 1 win and a goal difference of 0, and b beat a. d tops the table on +1.
    const table = standings(["a", "b", "c", "d"], [win("b", "a", 2, 1), win("a", "c", 2, 1), win("d", "b", 2, 1)]);
    expect(table.map((r) => r.playerId)).toEqual(["d", "b", "a", "c"]);
  });

  it("keeps seed order when head-to-head can't split a tie", () => {
    // A three-way cycle: everyone beat exactly one of the others by the same score.
    const table = standings(["a", "b", "c"], [win("b", "a", 2, 1), win("a", "c", 2, 1), win("c", "b", 2, 1)]);
    expect(table.map((r) => r.playerId)).toEqual(["a", "b", "c"]);
  });

  it("falls back to seed order for a complete tie", () => {
    expect(standings(["b", "a"], []).map((r) => r.playerId)).toEqual(["b", "a"]);
  });
});
