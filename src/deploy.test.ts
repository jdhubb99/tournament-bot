import { describe, expect, it, mock, spyOn } from "bun:test";
import { deployCommands, scopeFromArgs } from "./deploy.ts";
import { arg } from "./test/helpers.ts";

const ALL = ["ping", "tournament", "report", "undo", "bracket", "history", "leaderboard", "stats"];

function fakeRest() {
  return { put: mock(async (_route: string, _options: { body: { name: string }[] }) => []) };
}

async function quietly<T>(run: (log: ReturnType<typeof spyOn>) => Promise<T>): Promise<T> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    return await run(log);
  } finally {
    log.mockRestore();
  }
}

describe("deployCommands", () => {
  it("registers every command in the guild by default", async () => {
    const rest = fakeRest();
    await quietly(async (log) => {
      expect(await deployCommands(undefined, rest as never)).toBe(8);
      const [route, options] = rest.put.mock.calls[0]!;
      expect(route).toBe("/applications/test-client/guilds/guild-1/commands");
      expect(options.body.map((c) => c.name)).toEqual(ALL);
      expect(arg(log)).toBe("Registered 8 command(s) in guild guild-1");
    });
  });

  it("registers globally without /dev, then clears the guild's copies", async () => {
    const rest = fakeRest();
    process.env.DEV_COMMANDS = "true"; // even in dev mode, /dev never goes global
    try {
      await quietly(async (log) => {
        expect(await deployCommands("global", rest as never)).toBe(8);
        const [globalRoute, global] = rest.put.mock.calls[0]!;
        const [guildRoute, guild] = rest.put.mock.calls[1]!;
        expect(globalRoute).toBe("/applications/test-client/commands");
        expect(global.body.map((c) => c.name)).toEqual(ALL);
        expect(guildRoute).toBe("/applications/test-client/guilds/guild-1/commands");
        expect(guild.body).toEqual([]);
        expect(arg(log)).toBe("Registered 8 command(s) globally and cleared guild guild-1's copies");
      });
    } finally {
      delete process.env.DEV_COMMANDS;
    }
  });
});

describe("scopeFromArgs", () => {
  it("is global only with --global", () => {
    expect(scopeFromArgs(["bun", "src/deploy-commands.ts", "--global"])).toBe("global");
    expect(scopeFromArgs(["bun", "src/deploy-commands.ts"])).toBe("guild");
  });
});
