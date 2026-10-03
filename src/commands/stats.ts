import { AttachmentBuilder, SlashCommandBuilder } from "discord.js";
import { avatarsFor } from "../announce.ts";
import { headToHead, leaderboard } from "../logic/stats.ts";
import { statsEmbed } from "../render/embeds.ts";
import { renderPlayerStatsImage, STATS_FILE } from "../render/stats-images.ts";
import { decidedMatches, DEFAULT_GAME, titleCounts } from "../store.ts";
import { playerName } from "../views.ts";
import type { Command } from "./types.ts";

export const stats: Command = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("A player's titles, records, and head-to-head against everyone they've played")
    .addUserOption((o) => o.setName("player").setDescription("Whose stats (default you)"))
    .addStringOption((o) => o.setName("game").setDescription(`Which game (default ${DEFAULT_GAME})`)),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("player") ?? interaction.user;
    const game = interaction.options.getString("game")?.trim() || DEFAULT_GAME;
    const matches = decidedMatches(interaction.guildId, game);
    const me = leaderboard(matches, titleCounts(interaction.guildId, game)).find((r) => r.playerId === user.id);
    if (!me) {
      await interaction.reply({ content: `<@${user.id}> hasn't played any ${game} matches yet.`, allowedMentions: { parse: [] } });
      return;
    }

    // Avatar downloads and rendering can take a moment.
    await interaction.deferReply();
    const opponents = headToHead(matches, user.id);
    const avatars = await avatarsFor([user.id, ...opponents.map((o) => o.opponentId)]);
    const png = renderPlayerStatsImage(
      { ...me, name: playerName(user.id), avatar: avatars.get(user.id) ?? null },
      opponents.map((o) => ({ ...o, name: playerName(o.opponentId), avatar: avatars.get(o.opponentId) ?? null })),
    );
    await interaction.editReply({
      embeds: [statsEmbed(`${playerName(user.id)} — ${game}`, STATS_FILE)],
      files: [new AttachmentBuilder(Buffer.from(png), { name: STATS_FILE })],
    });
  },
};
