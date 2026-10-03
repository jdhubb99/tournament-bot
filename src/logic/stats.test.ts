import { describe, expect, it } from "bun:test";
import { headToHead, leaderboard, type MatchRecord } from "./stats.ts";

/** A best-of-1 match: `winner` beats `loser` w–l. */
const bo1 = (winner: string, loser: string, w = 2, l = 1): MatchRecord => ({
  p1: winner,
  p2: loser,
  winner,
  games: [{ p1_score: w, p2_score: l }],
});

/** A series: games given as [p1 goals, p2 goals]. */
const series = (p1: string, p2: string, winner: string, games: [number, number][]): MatchRecord => ({
  p1,
  p2,
  winner,
  games: games.map(([p1_score, p2_score]) => ({ p1_score, p2_score })),
});

describe("leaderboard", () => {
  it("totals series, games and goals across every match", () => {
    const [jake] = leaderboard([bo1("jake", "ivan", 3, 1), series("ivan", "jake", "jake", [[2, 0], [1, 4], [0, 1]])], new Map());
    expect(jake).toEqual({
      playerId: "jake",
      titles: 0,
      played: 2,
      wins: 2,
      losses: 0,
      gameWins: 3,
      gameLosses: 1,
      goalsFor: 3 + 0 + 4 + 1,
      goalsAgainst: 1 + 2 + 1 + 0,
    });
  });

  it("ranks titles above everything else", () => {
    const table = leaderboard([bo1("a", "b"), bo1("a", "b"), bo1("a", "c")], new Map([["c", 1]]));
    expect(table.map((r) => [r.playerId, r.titles])).toEqual([
      ["c", 1],
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("then series wins, then game difference, then goal difference", () => {
    // a and b: 1 series win each; b's came in a longer series with a better game difference.
    const byGames = leaderboard(
      [series("a", "x", "a", [[1, 0], [0, 1], [1, 0]]), series("b", "y", "b", [[1, 0], [1, 0]])],
      new Map(),
    );
    expect(byGames.map((r) => r.playerId).slice(0, 2)).toEqual(["b", "a"]);

    const byGoals = leaderboard([bo1("a", "x", 2, 1), bo1("b", "y", 5, 0)], new Map());
    expect(byGoals.map((r) => r.playerId).slice(0, 2)).toEqual(["b", "a"]);
  });

  it("then fewest losses", () => {
    // Both have 1 series win, +2 games and +2 goals; "a" also lost once, so "z" ranks first despite its id.
    const table = leaderboard(
      [
        series("z", "x", "z", [[1, 0], [1, 0]]),
        series("a", "y", "a", [[1, 0], [1, 0], [1, 0]]),
        bo1("w", "a", 1, 0),
      ],
      new Map(),
    );
    const order = table.map((r) => r.playerId);
    expect(order.indexOf("z")).toBeLessThan(order.indexOf("a"));
  });

  it("then id, so equal records never shuffle", () => {
    expect(leaderboard([bo1("b", "x"), bo1("a", "y")], new Map()).map((r) => r.playerId).slice(0, 2)).toEqual(["a", "b"]);
  });

  it("is empty with no matches", () => {
    expect(leaderboard([], new Map([["a", 2]]))).toEqual([]);
  });
});

describe("headToHead", () => {
  const matches = [
    bo1("jake", "ivan", 3, 1),
    series("ivan", "jake", "ivan", [[2, 0], [0, 1], [3, 2]]),
    bo1("benny", "jake", 4, 0),
    bo1("ivan", "benny"), // not involving jake
  ];

  it("gives the player's record against each opponent, most-played first", () => {
    expect(headToHead(matches, "jake")).toEqual([
      {
        opponentId: "ivan",
        playerId: "jake",
        played: 2,
        wins: 1,
        losses: 1,
        gameWins: 2,
        gameLosses: 2,
        goalsFor: 3 + 0 + 1 + 2,
        goalsAgainst: 1 + 2 + 0 + 3,
      },
      { opponentId: "benny", playerId: "jake", played: 1, wins: 0, losses: 1, gameWins: 0, gameLosses: 1, goalsFor: 0, goalsAgainst: 4 },
    ]);
  });

  it("orders equally played matchups by opponent", () => {
    expect(headToHead([bo1("a", "c"), bo1("a", "b")], "a").map((h) => h.opponentId)).toEqual(["b", "c"]);
  });

  it("is empty for someone who hasn't played", () => {
    expect(headToHead(matches, "nobody")).toEqual([]);
  });
});
