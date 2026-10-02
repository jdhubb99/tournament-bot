import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { cancelTournament, getOpenTournament, listTournamentPlayers } from "../store.ts";
import { FULL_MESSAGE, joinSignup, MAX_PLAYERS } from "./tournament.ts";
import type { Command } from "./types.ts";

type Interaction = ChatInputCommandInteraction<"cached">;

const reply = (interaction: Interaction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

async function join(interaction: Interaction) {
  const tournament = getOpenTournament(interaction.guildId);
  if (tournament?.status !== "signup") {
    await reply(interaction, "No tournament is in signup. Run `/tournament start` first.");
    return;
  }

  const user = interaction.options.getUser("user", true);
  const name = interaction.options.getMember("user")?.displayName ?? user.displayName;
  switch (joinSignup(tournament.id, user.id, name)) {
    case "already":
      return void (await reply(interaction, `<@${user.id}> has already joined.`));
    case "full":
      return void (await reply(interaction, FULL_MESSAGE));
    case "joined":
      return void (await reply(
        interaction,
        `Added <@${user.id}> (${listTournamentPlayers(tournament.id).length}/${MAX_PLAYERS}). ` +
          "The signup message's list refreshes on the next Join or Start click.",
      ));
  }
}

async function cancel(interaction: Interaction) {
  const tournament = getOpenTournament(interaction.guildId);
  if (!tournament) {
    await reply(interaction, "No tournament is running.");
    return;
  }
  cancelTournament(tournament.id);
  await reply(interaction, `Cancelled tournament #${tournament.id}. You can run \`/tournament start\` again.`);
}

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
    )
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel the current tournament (signup or in progress)")),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    switch (interaction.options.getSubcommand()) {
      case "join":
        return join(interaction);
      case "cancel":
        return cancel(interaction);
    }
  },
};
