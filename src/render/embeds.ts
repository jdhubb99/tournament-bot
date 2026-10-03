import { EmbedBuilder } from "discord.js";
import { seriesState, winsNeeded, type GameScore } from "../logic/series.ts";
import { BRACKET_FILE } from "./bracket-image.ts";
import { SCOREBOARD_FILE, VERSUS_FILE, WINNER_FILE } from "./match-images.ts";

const LIVE_RED = 0xed4245;
const GREEN = 0x2ecc71;
const BLURPLE = 0x5865f2;

export interface EmbedPlayer {
  id: string;
  name: string;
  avatarUrl: string;
}

export function signupEmbed(opts: {
  players: { discord_id: string }[];
  semisBestOf: number;
  finalBestOf: number;
  maxPlayers: number;
  closed: boolean;
}): EmbedBuilder {
  const list = opts.players.length
    ? opts.players.map((p, i) => `${i + 1}. <@${p.discord_id}>`).join("\n")
    : "_No one yet_";
  return new EmbedBuilder()
    .setColor(opts.closed ? GREEN : BLURPLE)
    .setTitle(opts.closed ? "Rocket League 1v1 — Signup closed" : "Rocket League 1v1 — Signup open")
    .setDescription(opts.closed ? "The tournament has started. Good luck!" : "Click **Join** to play. Click **Start** once everyone's in.")
    .addFields(
      { name: `Players (${opts.players.length}/${opts.maxPlayers})`, value: list },
      { name: "Series", value: `Semis Bo${opts.semisBestOf} · Final Bo${opts.finalBestOf}` },
    );
}

/** A live match: red stripe, the format, and both avatars in the attached versus image. */
export function liveMatchEmbed(opts: { label: string; bestOf: number; p1: EmbedPlayer; p2: EmbedPlayer }): EmbedBuilder {
  const format = opts.bestOf === 1 ? "Best of 1" : `Best of ${opts.bestOf} (first to ${winsNeeded(opts.bestOf)})`;
  return new EmbedBuilder()
    .setColor(LIVE_RED)
    .setTitle(`${opts.label} — Live`)
    .setDescription(`<@${opts.p1.id}> vs <@${opts.p2.id}>`)
    .addFields({ name: "Format", value: format })
    .setImage(`attachment://${VERSUS_FILE}`);
}

/** A series still in progress after a game: red stripe, the standing, and the attached scoreboard image. */
export function seriesUpdateEmbed(opts: { title: string; standing: string }): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(LIVE_RED)
    .setTitle(opts.title)
    .setDescription(opts.standing)
    .setImage(`attachment://${SCOREBOARD_FILE}`);
}

/**
 * A decided match: green stripe with only the winner's picture (the attached winner image). Best of 1 shows the
 * goals as the final score; longer series show games won plus each game's goals.
 */
export function matchResultEmbed(opts: {
  label: string;
  bestOf: number;
  p1: EmbedPlayer;
  p2: EmbedPlayer;
  games: GameScore[];
  winnerId: string;
}): EmbedBuilder {
  const { p1, p2 } = opts;
  const winner = p1.id === opts.winnerId ? p1 : p2;
  const name = (p: EmbedPlayer) => (p === winner ? `**${p.name}**` : p.name);
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle(`${opts.label} — ${winner.name} wins`)
    .setDescription(`<@${p1.id}> vs <@${p2.id}>`)
    .setThumbnail(`attachment://${WINNER_FILE}`);

  if (opts.bestOf === 1) {
    const game = opts.games[0]!;
    return embed.addFields({ name: "Final score", value: `${name(p1)} ${game.p1_score} – ${game.p2_score} ${name(p2)}` });
  }

  const series = seriesState(opts.games, opts.bestOf);
  const games = opts.games.map((g, i) => {
    const [gameWinner, high, low] = g.p1_score > g.p2_score ? [p1, g.p1_score, g.p2_score] : [p2, g.p2_score, g.p1_score];
    return `Game ${i + 1}: ${gameWinner.name} ${high}–${low}`;
  });
  return embed.addFields(
    { name: `Series (best of ${opts.bestOf})`, value: `${name(p1)} ${series.p1Wins} – ${series.p2Wins} ${name(p2)}` },
    { name: "Games", value: games.join("\n") },
  );
}

const GOLD = 0xd4af37;

/**
 * "Semifinal 1: **Jake** def. Benny (6–5)" for goals in a best of 1, or
 * "Final: **Jake** def. Benny (series 2–1)" for games won in a longer series.
 */
export function resultLine(opts: {
  label: string;
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
  series: boolean;
}): string {
  const score = `${opts.series ? "series " : ""}${opts.winnerScore}–${opts.loserScore}`;
  return `${opts.label}: **${opts.winnerName}** def. ${opts.loserName} (${score})`;
}

/** Gold, with the champion's picture (the attached winner image), the runner-up, and every result. */
export function championEmbed(opts: { champion: EmbedPlayer; runnerUpName: string; results: string[] }): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🏆 ${opts.champion.name} is the champion!`)
    .setThumbnail(`attachment://${WINNER_FILE}`)
    .addFields(
      { name: "Runner-up", value: opts.runnerUpName },
      { name: "Results", value: opts.results.join("\n") },
    );
}

/** /bracket: the attached bracket image, with the live match (and its series standing) as text. */
export function bracketEmbed(opts: { title: string; live: string | null }): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(BLURPLE).setTitle(opts.title).setImage(`attachment://${BRACKET_FILE}`);
  if (opts.live) embed.setDescription(`🔴 Live: ${opts.live}`);
  return embed;
}

/** The final table(s), posted when a league or group stage ends (the image is the /bracket one). */
export function standingsEmbed(title: string): EmbedBuilder {
  return new EmbedBuilder().setColor(GOLD).setTitle(title).setImage(`attachment://${BRACKET_FILE}`);
}

/** /history: one entry per finished tournament, newest first, separated by blank lines. */
export function historyEmbed(entries: string[]): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("Tournament history")
    .setDescription(entries.length ? entries.join("\n\n") : "No finished tournaments yet.");
}
