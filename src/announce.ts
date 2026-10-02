import { AttachmentBuilder } from "discord.js";
import { tournamentChannel } from "./channel.ts";
import { env } from "./env.ts";
import { otherTeam } from "./logic/teams.ts";
import { matchEmbed, type EmbedPlayer } from "./render/embeds.ts";
import { renderVersusImage, VERSUS_FILE } from "./render/versus-image.ts";
import type { Match } from "./store.ts";

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
    embeds: [matchEmbed({ label: match.label, bestOf: match.best_of, p1, p2, p1Wins: 0, p2Wins: 0 })],
    files: [image],
    allowedMentions: { users: env.devCommands ? [] : [p1.id, p2.id] },
  });
}
