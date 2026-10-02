import { AttachmentBuilder, type EmbedBuilder } from "discord.js";
import { tournamentChannel } from "./channel.ts";
import { env } from "./env.ts";
import { describeSeries, seriesState, type SeriesState } from "./logic/series.ts";
import { otherTeam, type Team } from "./logic/teams.ts";
import {
  championEmbed,
  liveMatchEmbed,
  matchResultEmbed,
  seriesUpdateEmbed,
  type EmbedPlayer,
} from "./render/embeds.ts";
import {
  renderScoreboardImage,
  renderVersusImage,
  renderWinnerImage,
  SCOREBOARD_FILE,
  VERSUS_FILE,
  WINNER_FILE,
} from "./render/match-images.ts";
import { BRACKET_FILE, renderBracketImage, type BracketSlot } from "./render/bracket-image.ts";
import { getTournament, listGames, listMatches, listTournamentPlayers, type Match } from "./store.ts";
import { playerName, resultLineFor, runnerUpOf, slotPlaceholder } from "./views.ts";

// Static PNGs so animated avatars and webp still render in the versus image.
const AVATAR_OPTIONS = { extension: "png", forceStatic: true, size: 256 } as const;

async function embedPlayer(id: string): Promise<EmbedPlayer> {
  const channel = tournamentChannel();
  const member = await channel.guild.members.fetch(id).catch(() => null);
  if (member) return { id, name: member.displayName, avatarUrl: member.displayAvatarURL(AVATAR_OPTIONS) };
  const user = await channel.client.users.fetch(id);
  return { id, name: user.displayName, avatarUrl: user.displayAvatarURL(AVATAR_OPTIONS) };
}

/** Downloads an avatar; null on any failure so the image falls back to a placeholder. */
export async function fetchAvatar(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

type Post = { embed: EmbedBuilder; file: AttachmentBuilder };

/** The red live embed with the team-colored versus image, for a match with no games yet. */
async function versusPost(match: Match): Promise<Post> {
  const [p1, p2] = await Promise.all([embedPlayer(match.p1_id!), embedPlayer(match.p2_id!)]);
  const [p1Avatar, p2Avatar] = await Promise.all([fetchAvatar(p1.avatarUrl), fetchAvatar(p2.avatarUrl)]);
  const png = renderVersusImage(
    { avatar: p1Avatar, team: teamIn(match, p1.id) },
    { avatar: p2Avatar, team: teamIn(match, p2.id) },
  );
  return {
    embed: liveMatchEmbed({ label: match.label, bestOf: match.best_of, p1, p2 }),
    file: new AttachmentBuilder(Buffer.from(png), { name: VERSUS_FILE }),
  };
}

/** Posts "Up next" with the versus image, pinging only its two players (nobody in dev mode). */
export async function announceLiveMatch(match: Match): Promise<void> {
  if (!match.p1_id || !match.p2_id) throw new Error(`Match ${match.id} went live without both players`);
  if (!match.p1_team) throw new Error(`Match ${match.id} went live without teams`);
  const { embed, file } = await versusPost(match);
  await tournamentChannel().send({
    content: `Up next: <@${match.p1_id}> vs <@${match.p2_id}> (Bo${match.best_of})`,
    embeds: [embed],
    files: [file],
    allowedMentions: { users: env.devCommands ? [] : [match.p1_id, match.p2_id] },
  });
}

/**
 * A live match as it stands now: the versus image if no games have been played,
 * otherwise the scoreboard with the current standing. Used after /undo.
 */
export async function currentMatchPost(match: Match): Promise<Post> {
  const games = listGames(match.id);
  if (games.length === 0) return versusPost(match);
  return seriesUpdate(match, seriesState(games, match.best_of), `${match.label} — Live`);
}

/** The team a player was on in a match. */
function teamIn(match: Match, playerId: string): Team {
  if (!match.p1_team) throw new Error(`Match ${match.id} has no teams`);
  return match.p1_id === playerId ? match.p1_team : otherTeam(match.p1_team);
}

/** The winner image as an upload, ringed in the team they won with. */
async function winnerImage(winner: EmbedPlayer, team: Team): Promise<AttachmentBuilder> {
  const png = renderWinnerImage({ avatar: await fetchAvatar(winner.avatarUrl), team });
  return new AttachmentBuilder(Buffer.from(png), { name: WINNER_FILE });
}

/** The green result embed for a decided match, plus the winner image it shows. */
export async function matchResult(match: Match): Promise<Post> {
  const [p1, p2] = await Promise.all([embedPlayer(match.p1_id!), embedPlayer(match.p2_id!)]);
  const winner = match.winner_id === p1.id ? p1 : p2;
  const embed = matchResultEmbed({
    label: match.label,
    bestOf: match.best_of,
    p1,
    p2,
    games: listGames(match.id),
    winnerId: winner.id,
  });
  return { embed, file: await winnerImage(winner, teamIn(match, winner.id)) };
}

/** The red update for a series still in progress, plus the scoreboard image it shows. */
export async function seriesUpdate(match: Match, series: SeriesState, title: string): Promise<Post> {
  const [p1, p2] = await Promise.all([embedPlayer(match.p1_id!), embedPlayer(match.p2_id!)]);
  const [p1Avatar, p2Avatar] = await Promise.all([fetchAvatar(p1.avatarUrl), fetchAvatar(p2.avatarUrl)]);
  const png = renderScoreboardImage(
    { avatar: p1Avatar, team: teamIn(match, p1.id) },
    { avatar: p2Avatar, team: teamIn(match, p2.id) },
    series.p1Wins,
    series.p2Wins,
  );
  return {
    embed: seriesUpdateEmbed({ title, standing: describeSeries(series, p1.name, p2.name) }),
    file: new AttachmentBuilder(Buffer.from(png), { name: SCOREBOARD_FILE }),
  };
}

/** Crowns the champion with a summary of every match, pinging only the champion (nobody in dev mode). */
export async function announceChampion(tournamentId: number, championId: string): Promise<void> {
  const matches = listMatches(tournamentId);
  const final = matches.at(-1)!;
  const results = matches.map(resultLineFor);

  const champion = await embedPlayer(championId);
  await tournamentChannel().send({
    content: `🏆 <@${championId}> wins the tournament!`,
    embeds: [championEmbed({ champion, runnerUpName: runnerUpOf(matches), results })],
    files: [await winnerImage(champion, teamIn(final, championId))],
    allowedMentions: { users: env.devCommands ? [] : [championId] },
  });
}

/** The single-elimination bracket image for /bracket, with every known player's avatar. */
export async function bracketImage(tournamentId: number): Promise<AttachmentBuilder> {
  const tournament = getTournament(tournamentId)!;
  const matches = listMatches(tournamentId);
  const seeds = new Map(listTournamentPlayers(tournamentId).map((p, i) => [p.discord_id, i + 1]));

  // The champion played in the final, so their avatar is among these.
  const ids = [...new Set(matches.flatMap((m) => [m.p1_id, m.p2_id]).filter((id): id is string => id !== null))];
  const avatars = new Map(
    await Promise.all(ids.map(async (id) => [id, await fetchAvatar((await embedPlayer(id)).avatarUrl)] as const)),
  );

  const slot = (match: Match, side: "p1" | "p2"): BracketSlot => {
    const id = side === "p1" ? match.p1_id : match.p2_id;
    const games = listGames(match.id);
    const series = seriesState(games, match.best_of);
    // Best of 1: the game's goals once it's played. Longer series: games won once the match has started.
    const score =
      match.status === "pending"
        ? null
        : match.best_of === 1
          ? (games[0]?.[side === "p1" ? "p1_score" : "p2_score"] ?? null)
          : side === "p1"
            ? series.p1Wins
            : series.p2Wins;
    return {
      name: id ? playerName(id) : null,
      placeholder: slotPlaceholder(match, matches, side),
      avatar: id ? (avatars.get(id) ?? null) : null,
      team: id && match.p1_team ? teamIn(match, id) : null,
      seed: id ? (seeds.get(id) ?? null) : null,
      score,
      won: id !== null && match.winner_id === id,
    };
  };

  const png = renderBracketImage(
    matches.map((m) => ({ label: m.label, bestOf: m.best_of, status: m.status, p1: slot(m, "p1"), p2: slot(m, "p2") })),
    tournament.winner_id
      ? { name: playerName(tournament.winner_id), avatar: avatars.get(tournament.winner_id) ?? null }
      : null,
  );
  return new AttachmentBuilder(Buffer.from(png), { name: BRACKET_FILE });
}
