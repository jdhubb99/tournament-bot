import { expect, it } from "bun:test";
import { formatFor, MAX_PLAYERS, MIN_PLAYERS } from "./format.ts";

it("picks the format for each supported player count", () => {
  expect([4, 5, 6, 7, 8].map(formatFor)).toEqual(["single_elim", "round_robin", "groups", "groups", "single_elim"]);
});

it("has no format below 4 or above 8 players", () => {
  expect([0, 3, 9, 12].map(formatFor)).toEqual([null, null, null, null]);
  expect([MIN_PLAYERS, MAX_PLAYERS]).toEqual([4, 8]);
});
