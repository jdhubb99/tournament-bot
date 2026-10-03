import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { cancelTournament, getOpenTournament, listTournamentPlayers } from "../store.ts";
import { refreshBracketMessage } from "../announce.ts";
import { MAX_PLAYERS } from "../logic/format.ts";
import { joinSignup, type JoinResult } from "./tournament.ts";
import type { Command } from "./types.ts";

type Interaction = ChatInputCommandInteraction<"cached">;

const reply = (interaction: Interaction, content: string) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

const JOIN_SLOTS = MAX_PLAYERS;

async function join(interaction: Interaction) {
  const tournament = getOpenTournament(interaction.guildId);
  if (tournament?.status !== "signup") {
    await reply(interaction, "No tournament is in signup. Run `/tournament start` first.");
    return;
  }

  const results: Record<JoinResult, string[]> = { joined: [], already: [], full: [] };
  const seen = new Set<string>();
  for (let slot = 1; slot <= JOIN_SLOTS; slot++) {
    const user = interaction.options.getUser(`user${slot}`);
    if (!user || seen.has(user.id)) continue;
    seen.add(user.id);
    const name = interaction.options.getMember(`user${slot}`)?.displayName ?? user.displayName;
    results[joinSignup(tournament.id, user.id, name)].push(`<@${user.id}>`);
  }

  const count = listTournamentPlayers(tournament.id).length;
  const lines = [
    results.joined.length ? `Added ${results.joined.join(", ")} (${count}/${MAX_PLAYERS}).` : `Nobody new was added (${count}/${MAX_PLAYERS}).`,
    results.already.length ? `Already joined: ${results.already.join(", ")}.` : null,
    results.full.length ? `Not added, the tournament is full: ${results.full.join(", ")}.` : null,
    results.joined.length ? "The signup message's list refreshes on the next Join or Start click." : null,
  ];
  await reply(interaction, lines.filter(Boolean).join("\n"));
}

async function cancel(interaction: Interaction) {
  const tournament = getOpenTournament(interaction.guildId);
  if (!tournament) {
    await reply(interaction, "No tournament is running.");
    return;
  }
  cancelTournament(tournament.id);
  if (tournament.status === "active") await refreshBracketMessage(tournament.id);
  await reply(interaction, `Cancelled tournament #${tournament.id}. You can run \`/tournament start\` again.`);
}

// Only registered when DEV_COMMANDS=true (see commands/index.ts), for testing without other people online.
export const dev: Command = {
  data: new SlashCommandBuilder()
    .setName("dev")
    .setDescription("Testing tools (dev mode only)")
    .addSubcommand((sub) => {
      sub
        .setName("join")
        .setDescription("Add up to 8 server members (or bots) to the current signup at once")
        .addUserOption((o) => o.setName("user1").setDescription("Who to add").setRequired(true));
      for (let slot = 2; slot <= JOIN_SLOTS; slot++) {
        sub.addUserOption((o) => o.setName(`user${slot}`).setDescription("Also add"));
      }
      return sub;
    })
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
