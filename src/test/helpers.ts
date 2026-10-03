import { mock } from "bun:test";
import { ChannelType } from "discord.js";
import { useTournamentChannel } from "../channel.ts";
import { db } from "../db.ts";
import { singleElim } from "../logic/bracket.ts";
import { groupsPlan } from "../logic/groups.ts";
import { roundRobinPlan } from "../logic/roundrobin.ts";
import {
  addTournamentPlayer,
  createTournament,
  getLiveMatch,
  getTournament,
  recordGame,
  startTournament,
  upsertPlayer,
  type GameOutcome,
} from "../store.ts";

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

/** Installs a fresh fake #tournaments channel and returns it. */
export function useFakeChannel(opts: Parameters<typeof fakeChannel>[0] = {}) {
  const channel = fakeChannel(opts);
  useTournamentChannel(cast(channel));
  return channel;
}

/** A slash command or button interaction with every reply method mocked. */
export function fakeInteraction(opts: {
  kind?: "command" | "button" | "other";
  commandName?: string;
  subcommand?: string;
  integers?: Record<string, number>;
  strings?: Record<string, string>;
  customId?: string;
  channelId?: string;
  user?: { id: string; name: string };
  cached?: boolean;
  replied?: boolean;
  /** User options by name; `memberName` set means they're a server member. */
  optionUsers?: Record<string, { id: string; name: string; memberName?: string }>;
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
      getString: (name: string) => opts.strings?.[name] ?? null,
      getUser: (name: string) => {
        const user = opts.optionUsers?.[name];
        return user ? { id: user.id, displayName: user.name } : null;
      },
      getMember: (name: string) => {
        const memberName = opts.optionUsers?.[name]?.memberName;
        return memberName ? { displayName: memberName } : null;
      },
    },
    inCachedGuild: () => opts.cached ?? true,
    isChatInputCommand: () => (opts.kind ?? "command") === "command",
    isButton: () => opts.kind === "button",
    reply: mock(async (_message: unknown) => {}),
    followUp: mock(async (_message: unknown) => {}),
    update: mock(async (_message: unknown) => {}),
    deferUpdate: mock(async () => {}),
    deferReply: mock(async () => {}),
    editReply: mock(async (_message: unknown) => {}),
  };
}

/** The first argument of a mock's nth call, typed loosely for assertions. */
export function arg(fn: { mock: { calls: unknown[][] } }, call = 0): any {
  return fn.mock.calls[call]?.[0];
}

/**
 * Creates an active single-elim tournament with players a, b, c, d (seeded in that
 * order, display names A–D), so Semifinal 1 (a vs b, p1 on Goons) is live.
 */
export function startedTournament(lengths = { semis: 1, final: 3 }): number {
  const id = createTournament("guild-1", lengths);
  const seeded = ["a", "b", "c", "d"];
  for (const p of seeded) {
    upsertPlayer(p, p.toUpperCase());
    addTournamentPlayer(id, p);
  }
  startTournament(id, "single_elim", seeded, singleElim(seeded, lengths), "goons");
  return id;
}

/** An active 5-player round robin with players a–e (seeded in that order, names A–E). Match 1 is live. */
export function startedRoundRobin(finalBestOf = 3): number {
  const id = createTournament("guild-1", { semis: 1, final: finalBestOf });
  const seeded = ["a", "b", "c", "d", "e"];
  for (const p of seeded) {
    upsertPlayer(p, p.toUpperCase());
    addTournamentPlayer(id, p);
  }
  startTournament(id, "round_robin", seeded, roundRobinPlan(seeded, finalBestOf), "goons");
  return id;
}

/**
 * Reports the live best-of-1 league match with the alphabetically earlier player winning 2–1,
 * so a full league ends a (4 wins), b (3), c (2), d (1), e (0).
 */
export function playLeagueMatch(id: number): GameOutcome {
  const match = getLiveMatch(id)!;
  const p1Wins = match.p1_id! < match.p2_id!;
  return recordGame(match, p1Wins ? 2 : 1, p1Wins ? 1 : 2, "r", "goons");
}

/** Plays every league match; returns the outcome of the last one (which fills the final). */
export function playLeague(id: number): GameOutcome {
  for (let i = 0; i < 9; i++) playLeagueMatch(id);
  return playLeagueMatch(id);
}

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function signedUp(count: number, lengths: { semis: number; final: number }): { id: number; seeded: string[] } {
  const id = createTournament("guild-1", lengths);
  const seeded = LETTERS.slice(0, count);
  for (const p of seeded) {
    upsertPlayer(p, p.toUpperCase());
    addTournamentPlayer(id, p);
  }
  return { id, seeded };
}

/**
 * An active groups tournament with 6 or 7 players a–g seeded in order, so Group A is
 * a–c (or a–d) and Group B the rest. The first group match is live.
 */
export function startedGroups(count: 6 | 7, lengths = { semis: 1, final: 3 }): number {
  const { id, seeded } = signedUp(count, lengths);
  const { plan, groups } = groupsPlan(seeded, lengths);
  startTournament(id, "groups", seeded, plan, "goons", groups);
  return id;
}

/** An active 8-player knockout with players a–h seeded in order. Quarterfinal 1 is live. */
export function startedEight(lengths = { semis: 1, final: 3 }): number {
  const { id, seeded } = signedUp(8, lengths);
  startTournament(id, "single_elim", seeded, singleElim(seeded, lengths), "goons");
  return id;
}

/**
 * Plays every remaining game with the alphabetically earlier player winning 2–1, until the
 * tournament is done. Returns how many games were reported.
 */
export function playToTheEnd(id: number): number {
  let games = 0;
  while (getTournament(id)!.status === "active") {
    const match = getLiveMatch(id)!;
    const p1Wins = match.p1_id! < match.p2_id!;
    recordGame(match, p1Wins ? 2 : 1, p1Wins ? 1 : 2, "r", "goons");
    games++;
  }
  return games;
}
