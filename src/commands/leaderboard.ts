import { AttachmentBuilder, SlashCommandBuilder } from "discord.js";
import { avatarsFor } from "../announce.ts";
import { leaderboard as rank } from "../logic/stats.ts";
import { statsEmbed } from "../render/embeds.ts";
import { LEADERBOARD_FILE, renderLeaderboardImage } from "../render/stats-images.ts";
import { decidedMatches, DEFAULT_GAME, titleCounts } from "../store.ts";
import { playerName } from "../views.ts";
import type { Command } from "./types.ts";

/** More rows than this make the image too tall to read in Discord. */
const MAX_ROWS = 15;

export const leaderboard: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("All-time titles, series and game records, and goal difference")
    .addStringOption((o) => o.setName("game").setDescription(`Which game (default ${DEFAULT_GAME})`)),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const game = interaction.options.getString("game")?.trim() || DEFAULT_GAME;
    const table = rank(decidedMatches(interaction.guildId, game), titleCounts(interaction.guildId, game));
    if (table.length === 0) {
      await interaction.reply(`No ${game} matches have been played yet.`);
      return;
    }

    // Avatar downloads and rendering can take a moment.
    await interaction.deferReply();
    const shown = table.slice(0, MAX_ROWS);
    const avatars = await avatarsFor(shown.map((r) => r.playerId));
    const png = renderLeaderboardImage(
      game,
      shown.map((r) => ({ ...r, name: playerName(r.playerId), avatar: avatars.get(r.playerId) ?? null })),
    );
    const note = table.length > MAX_ROWS ? `Showing the top ${MAX_ROWS} of ${table.length} players.` : undefined;
    await interaction.editReply({
      embeds: [statsEmbed(`Leaderboard — ${game}`, LEADERBOARD_FILE, note)],
      files: [new AttachmentBuilder(Buffer.from(png), { name: LEADERBOARD_FILE })],
    });
  },
};
