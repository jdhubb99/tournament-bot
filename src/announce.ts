import { tournamentChannel } from "./channel.ts";
import { env } from "./env.ts";
import { matchEmbed, type EmbedPlayer } from "./render/embeds.ts";
import type { Match } from "./store.ts";

async function embedPlayer(id: string): Promise<EmbedPlayer> {
  const channel = tournamentChannel();
  const member = await channel.guild.members.fetch(id).catch(() => null);
  if (member) return { id, name: member.displayName, avatarUrl: member.displayAvatarURL() };
  const user = await channel.client.users.fetch(id);
  return { id, name: user.displayName, avatarUrl: user.displayAvatarURL() };
}

/** Posts the live match embed, pinging only its two players (nobody in dev mode). */
export async function announceLiveMatch(match: Match): Promise<void> {
  if (!match.p1_id || !match.p2_id) throw new Error(`Match ${match.id} went live without both players`);
  const [p1, p2] = await Promise.all([embedPlayer(match.p1_id), embedPlayer(match.p2_id)]);
  await tournamentChannel().send({
    content: `Up next: <@${p1.id}> vs <@${p2.id}> (Bo${match.best_of})`,
    embeds: [matchEmbed({ label: match.label, bestOf: match.best_of, p1, p2, p1Wins: 0, p2Wins: 0, finished: false })],
    allowedMentions: { users: env.devCommands ? [] : [p1.id, p2.id] },
  });
}
