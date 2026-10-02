import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { getOpenTournament, listTournamentPlayers } from "../store.ts";
import { FULL_MESSAGE, joinSignup, MAX_PLAYERS } from "./tournament.ts";
import type { Command } from "./types.ts";

// Only registered when DEV_COMMANDS=true (see commands/index.ts), for testing without other people online.
export const dev: Command = {
  data: new SlashCommandBuilder()
    .setName("dev")
    .setDescription("Testing tools (dev mode only)")
    .addSubcommand((sub) =>
      sub
        .setName("join")
        .setDescription("Add any server member (or bot) to the current signup")
        .addUserOption((o) => o.setName("user").setDescription("Who to add").setRequired(true)),
    ),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    const tournament = getOpenTournament(interaction.guildId);
    if (tournament?.status !== "signup") {
      await reply("No tournament is in signup. Run `/tournament start` first.");
      return;
    }

    const user = interaction.options.getUser("user", true);
    const name = interaction.options.getMember("user")?.displayName ?? user.displayName;
    switch (joinSignup(tournament.id, user.id, name)) {
      case "already":
        return void (await reply(`<@${user.id}> has already joined.`));
      case "full":
        return void (await reply(FULL_MESSAGE));
      case "joined": {
        const count = listTournamentPlayers(tournament.id).length;
        return void (await reply(
          `Added <@${user.id}> (${count}/${MAX_PLAYERS}). The signup message's list refreshes on the next Join or Start click.`,
        ));
      }
    }
  },
};
