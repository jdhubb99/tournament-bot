import { AttachmentBuilder, type EmbedBuilder } from "discord.js";
import { tournamentChannel } from "./channel.ts";
import { env } from "./env.ts";
import { seriesState } from "./logic/series.ts";
import { otherTeam, type Team } from "./logic/teams.ts";
import { championEmbed, liveMatchEmbed, matchResultEmbed, resultLine, type EmbedPlayer } from "./render/embeds.ts";
import { renderVersusImage, renderWinnerImage, VERSUS_FILE, WINNER_FILE } from "./render/match-images.ts";
import { getPlayer, listGames, listMatches, type Match } from "./store.ts";

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

/** Posts the live match embed with the team-colored versus image, pinging only its two players (nobody in dev mode). */
export async function announceLiveMatch(match: Match): Promise<void> {
  if (!match.p1_id || !match.p2_id) throw new Error(`Match ${match.id} went live without both players`);
  if (!match.p1_team) throw new Error(`Match ${match.id} went live without teams`);
  const [p1, p2] = await Promise.all([embedPlayer(match.p1_id), embedPlayer(match.p2_id)]);
  const [p1Avatar, p2Avatar] = await Promise.all([fetchAvatar(p1.avatarUrl), fetchAvatar(p2.avatarUrl)]);
  const png = renderVersusImage(
    { avatar: p1Avatar, team: match.p1_team },
    { avatar: p2Avatar, team: otherTeam(match.p1_team) },
  );
  const image = new AttachmentBuilder(Buffer.from(png), { name: VERSUS_FILE });

  await tournamentChannel().send({
    content: `Up next: <@${p1.id}> vs <@${p2.id}> (Bo${match.best_of})`,
    embeds: [liveMatchEmbed({ label: match.label, bestOf: match.best_of, p1, p2 })],
    files: [image],
    allowedMentions: { users: env.devCommands ? [] : [p1.id, p2.id] },
  });
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
export async function matchResult(match: Match): Promise<{ embed: EmbedBuilder; file: AttachmentBuilder }> {
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

/** Crowns the champion with a summary of every match, pinging only the champion (nobody in dev mode). */
export async function announceChampion(tournamentId: number, championId: string): Promise<void> {
  const name = (id: string) => getPlayer(id)?.display_name ?? id;
  const matches = listMatches(tournamentId);
  const final = matches.at(-1)!;
  const runnerUp = final.p1_id === championId ? final.p2_id! : final.p1_id!;

  const results = matches.map((m) => {
    const games = listGames(m.id);
    const series = seriesState(games, m.best_of);
    const winnerIsP1 = m.p1_id === m.winner_id;
    const loserId = winnerIsP1 ? m.p2_id! : m.p1_id!;
    // Bo1: show the goals of the single game. Longer series: show games won.
    const [p1, p2] = m.best_of === 1 ? [games[0]!.p1_score, games[0]!.p2_score] : [series.p1Wins, series.p2Wins];
    return resultLine({
      label: m.label,
      winnerName: name(m.winner_id!),
      loserName: name(loserId),
      winnerScore: winnerIsP1 ? p1 : p2,
      loserScore: winnerIsP1 ? p2 : p1,
      series: m.best_of > 1,
    });
  });

  const champion = await embedPlayer(championId);
  await tournamentChannel().send({
    content: `🏆 <@${championId}> wins the tournament!`,
    embeds: [championEmbed({ champion, runnerUpName: name(runnerUp), results })],
    files: [await winnerImage(champion, teamIn(final, championId))],
    allowedMentions: { users: env.devCommands ? [] : [championId] },
  });
}
