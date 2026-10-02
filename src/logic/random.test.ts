import { describe, expect, it } from "bun:test";
import { pick, shuffle } from "./random.ts";

describe("shuffle", () => {
  it("returns a permutation without changing the input", () => {
    const input = ["a", "b", "c", "d", "e"];
    const result = shuffle(input);
    expect(input).toEqual(["a", "b", "c", "d", "e"]);
    expect([...result].sort()).toEqual(input);
  });

  it("is deterministic for a given rng", () => {
    // rng() = 0 always swaps i with 0, which rotates the array left by one.
    expect(shuffle([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });
});

describe("pick", () => {
  it("picks the requested number of distinct items", () => {
    const result = pick(["a", "b", "c", "d"], 2);
    expect(result).toHaveLength(2);
    expect(new Set(result).size).toBe(2);
  });
});
