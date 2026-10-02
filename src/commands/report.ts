import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { announceChampion, announceLiveMatch, matchResult } from "../announce.ts";
import { checkReport, describeSeries } from "../logic/series.ts";
import { randomTeam } from "../logic/teams.ts";
import { getLiveMatch, getOpenTournament, getPlayer, recordGame } from "../store.ts";
import type { Command } from "./types.ts";

const REASONS = {
  not_higher: "The winner's score must be higher than the loser's (no ties).",
  negative: "Scores must be whole numbers, 0 or more.",
} as const;

export const report: Command = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Record one game of the live match")
    .addUserOption((o) => o.setName("winner").setDescription("Who won this game").setRequired(true))
    .addIntegerOption((o) => o.setName("winner_score").setDescription("Winner's goals").setMinValue(0).setRequired(true))
    .addIntegerOption((o) => o.setName("loser_score").setDescription("Loser's goals").setMinValue(0).setRequired(true)),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const fail = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    const tournament = getOpenTournament(interaction.guildId);
    const match = tournament?.status === "active" ? getLiveMatch(tournament.id) : null;
    if (!match) {
      await fail("There's no live match to report right now.");
      return;
    }

    const winner = interaction.options.getUser("winner", true);
    const check = checkReport(
      { p1: match.p1_id!, p2: match.p2_id! },
      winner.id,
      interaction.options.getInteger("winner_score", true),
      interaction.options.getInteger("loser_score", true),
    );
    if (!check.ok) {
      await fail(
        check.reason === "not_in_match"
          ? `<@${winner.id}> isn't in the live match (${match.label}: <@${match.p1_id}> vs <@${match.p2_id}>).`
          : REASONS[check.reason],
      );
      return;
    }

    const outcome = recordGame(match, check.p1Score, check.p2Score, interaction.user.id, randomTeam());

    // Everything is saved; the rest is posting. Avatar lookups can be slow, so defer first.
    await interaction.deferReply();
    const p1Name = getPlayer(match.p1_id!)!.display_name;
    const p2Name = getPlayer(match.p2_id!)!.display_name;
    const [bold1, bold2] = check.p1Score > check.p2Score ? [`**${p1Name}**`, p2Name] : [p1Name, `**${p2Name}**`];
    const lines = [
      `Game ${outcome.game.game_number} · ${match.label}: ${bold1} ${check.p1Score} – ${check.p2Score} ${bold2}`,
    ];
    // A best of 1 is decided by its only game, so a series line would just repeat it.
    if (match.best_of > 1) lines.push(describeSeries(outcome.series, p1Name, p2Name));
    const content = lines.join("\n");

    const embeds = outcome.series.winner ? [await matchResult(outcome.match)] : [];
    await interaction.editReply({ content, embeds, allowedMentions: { parse: [] } });

    if (outcome.next) await announceLiveMatch(outcome.next);
    if (outcome.championId) await announceChampion(match.tournament_id, outcome.championId);
  },
};
