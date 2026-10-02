import { expect, it } from "bun:test";
import { buildCommands, commandsByName } from "./index.ts";

it("registers /dev only in dev mode", () => {
  expect(buildCommands(false).map((c) => c.data.name)).toEqual(["ping", "tournament"]);
  expect(buildCommands(true).map((c) => c.data.name)).toEqual(["ping", "tournament", "dev"]);
});

it("uses the non-dev list when DEV_COMMANDS is unset", () => {
  expect([...commandsByName.keys()]).toEqual(["ping", "tournament"]);
});
