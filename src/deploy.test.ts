import { expect, it, mock, spyOn } from "bun:test";
import { deployCommands } from "./deploy.ts";
import { arg } from "./test/helpers.ts";

it("registers every command in the guild", async () => {
  const rest = { put: mock(async (_route: string, _options: { body: { name: string }[] }) => []) };
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await deployCommands(rest as never)).toBe(8);
    const [route, options] = rest.put.mock.calls[0]!;
    expect(route).toBe("/applications/test-client/guilds/guild-1/commands");
    expect(options.body.map((c) => c.name)).toEqual(["ping", "tournament", "report", "undo", "bracket", "history", "leaderboard", "stats"]);
    expect(arg(log)).toBe("Registered 8 command(s) in guild guild-1");
  } finally {
    log.mockRestore();
  }
});
