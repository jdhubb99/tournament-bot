import { mock } from "bun:test";
import { ChannelType } from "discord.js";
import { db } from "../db.ts";

/** Casts a hand-built fake to the discord.js type a function expects. */
export function cast<T>(fake: unknown): T {
  return fake as T;
}

export function resetDb(): void {
  db.exec(`
    DELETE FROM games; DELETE FROM matches; DELETE FROM tournament_players;
    DELETE FROM tournaments; DELETE FROM players; DELETE FROM sqlite_sequence;
  `);
}

/** A #tournaments channel. `members` maps user id → server display name; others fall back to user lookup. */
export function fakeChannel(opts: { members?: Record<string, string>; permissions?: string[] | null } = {}) {
  const members = opts.members ?? {};
  return {
    id: "channel-1",
    name: "tournaments",
    type: ChannelType.GuildText,
    guildId: "guild-1",
    send: mock(async (_message: unknown) => {}),
    permissionsFor: () => {
      const granted = opts.permissions;
      if (granted === null) return null;
      return { has: (flag: bigint) => granted === undefined || granted.includes(String(flag)) };
    },
    guild: {
      members: {
        fetch: mock(async (id: string) => {
          const name = members[id];
          if (!name) throw new Error("Unknown Member");
          return { displayName: name, displayAvatarURL: () => `https://cdn.test/member/${id}.png` };
        }),
      },
    },
    client: {
      users: {
        fetch: mock(async (id: string) => ({
          displayName: `user-${id}`,
          displayAvatarURL: () => `https://cdn.test/user/${id}.png`,
        })),
      },
    },
  };
}

/** A slash command or button interaction with every reply method mocked. */
export function fakeInteraction(opts: {
  kind?: "command" | "button" | "other";
  commandName?: string;
  subcommand?: string;
  integers?: Record<string, number>;
  customId?: string;
  channelId?: string;
  user?: { id: string; name: string };
  cached?: boolean;
  replied?: boolean;
  /** Value of a `user` option; `memberName` set means they're a server member. */
  optionUser?: { id: string; name: string; memberName?: string };
}) {
  const user = opts.user ?? { id: "u1", name: "Player One" };
  return {
    commandName: opts.commandName ?? "tournament",
    customId: opts.customId ?? "",
    channelId: opts.channelId ?? "channel-1",
    guildId: "guild-1",
    user: { id: user.id },
    member: { displayName: user.name },
    client: { ws: { ping: 42 } },
    replied: opts.replied ?? false,
    deferred: false,
    options: {
      getSubcommand: () => opts.subcommand ?? "start",
      getInteger: (name: string) => opts.integers?.[name] ?? null,
      getUser: () => (opts.optionUser ? { id: opts.optionUser.id, displayName: opts.optionUser.name } : null),
      getMember: () => (opts.optionUser?.memberName ? { displayName: opts.optionUser.memberName } : null),
    },
    inCachedGuild: () => opts.cached ?? true,
    isChatInputCommand: () => (opts.kind ?? "command") === "command",
    isButton: () => opts.kind === "button",
    reply: mock(async (_message: unknown) => {}),
    followUp: mock(async (_message: unknown) => {}),
    update: mock(async (_message: unknown) => {}),
    deferUpdate: mock(async () => {}),
  };
}

/** The first argument of a mock's nth call, typed loosely for assertions. */
export function arg(fn: { mock: { calls: unknown[][] } }, call = 0): any {
  return fn.mock.calls[call]?.[0];
}
