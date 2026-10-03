import { SlashCommandBuilder } from "discord.js";
import { currentMatchPost, refreshBracketMessage } from "../announce.ts";
import { describeSeries } from "../logic/series.ts";
import { getUndoableTournament, undoLastGame } from "../store.ts";
import { playerName } from "../views.ts";
import type { Command } from "./types.ts";

export const undo: Command = {
  data: new SlashCommandBuilder().setName("undo").setDescription("Remove the most recently reported game"),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const tournament = getUndoableTournament(interaction.guildId);
    const outcome = tournament ? undoLastGame(tournament.id) : null;
    if (!outcome) {
      await interaction.reply("There's no reported game to undo.");
      return;
    }

    const { game, match, series } = outcome;
    const [p1, p2] = [playerName(match.p1_id!), playerName(match.p2_id!)];
    const lines = [`↩️ Removed game ${game.game_number} of ${match.label} (${p1} ${game.p1_score} – ${game.p2_score} ${p2}).`];
    if (outcome.tournamentReopened) lines.push("The tournament is back in progress and the champion has been cleared.");
    if (outcome.reopened) {
      const paused = outcome.paused ? ` ${outcome.paused.label} is back to waiting.` : "";
      lines.push(`${match.label} is live again.${paused}`);
    }
    if (match.best_of > 1) lines.push(describeSeries(series, p1, p2));

    // Public, like reports, so everyone sees the correction. The picture shows the match
    // as it stands now (versus image, or the scoreboard if games remain), like other live posts.
    await interaction.deferReply();
    const post = await currentMatchPost(match);
    await interaction.editReply({
      content: lines.join("\n"),
      embeds: [post.embed],
      files: [post.file],
      allowedMentions: { parse: [] },
    });
    await refreshBracketMessage(tournament!.id);
  },
};
