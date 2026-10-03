import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { announceLiveMatch } from "../announce.ts";
import { tournamentChannel } from "../channel.ts";
import { singleElim } from "../logic/bracket.ts";
import { formatFor, MAX_PLAYERS, MIN_PLAYERS } from "../logic/format.ts";
import { groupsPlan } from "../logic/groups.ts";
import { shuffle } from "../logic/random.ts";
import { roundRobinPlan } from "../logic/roundrobin.ts";
import { randomTeam } from "../logic/teams.ts";
import { signupEmbed } from "../render/embeds.ts";
import {
  addTournamentPlayer,
  cancelTournament,
  createTournament,
  getLiveMatch,
  getOpenTournament,
  getTournament,
  listTournamentPlayers,
  startTournament,
  upsertPlayer,
  type Tournament,
} from "../store.ts";
import type { Command } from "./types.ts";

const SERIES_CHOICES = [1, 3, 5].map((n) => ({ name: `Best of ${n}`, value: n }));

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;

function signupMessage(tournament: Tournament, closed: boolean) {
  const embed = signupEmbed({
    players: listTournamentPlayers(tournament.id),
    semisBestOf: tournament.semis_best_of,
    finalBestOf: tournament.final_best_of,
    maxPlayers: MAX_PLAYERS,
    closed,
  });
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tournament:join:${tournament.id}`).setLabel("Join").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tournament:start:${tournament.id}`).setLabel("Start").setStyle(ButtonStyle.Success),
  );
  return { embeds: [embed], components: closed ? [] : [buttons] };
}

async function start(interaction: ChatInputCommandInteraction<"cached">) {
  if (getOpenTournament(interaction.guildId)) {
    await interaction.reply(ephemeral("A tournament is already running. Finish or cancel it first."));
    return;
  }
  const id = createTournament(interaction.guildId, {
    semis: interaction.options.getInteger("semis") ?? 1,
    final: interaction.options.getInteger("final") ?? 3,
  });
  await interaction.reply(signupMessage(getTournament(id)!, false));
}

export type JoinResult = "joined" | "already" | "full";

/** Adds a player to a tournament in signup, enforcing the cap. Shared by the Join button and /dev join. */
export function joinSignup(tournamentId: number, playerId: string, displayName: string): JoinResult {
  const joined = listTournamentPlayers(tournamentId);
  if (joined.some((p) => p.discord_id === playerId)) return "already";
  if (joined.length >= MAX_PLAYERS) return "full";
  upsertPlayer(playerId, displayName);
  addTournamentPlayer(tournamentId, playerId);
  return "joined";
}

const FULL_MESSAGE = `The bot supports up to ${MAX_PLAYERS} players, and this tournament is full.`;

async function join(interaction: ButtonInteraction<"cached">, tournament: Tournament) {
  switch (joinSignup(tournament.id, interaction.user.id, interaction.member.displayName)) {
    case "already":
      return void (await interaction.deferUpdate());
    case "full":
      return void (await interaction.reply(ephemeral(FULL_MESSAGE)));
    case "joined":
      return void (await interaction.update(signupMessage(tournament, false)));
  }
}

async function begin(interaction: ButtonInteraction<"cached">, tournament: Tournament) {
  const players = listTournamentPlayers(tournament.id);
  if (players.length < MIN_PLAYERS) {
    await interaction.reply(ephemeral(`At least ${MIN_PLAYERS} players are needed to start (${players.length} joined).`));
    return;
  }
  // Join caps signup at MAX_PLAYERS and fewer than MIN_PLAYERS was refused above, so there's a format.
  const format = formatFor(players.length)!;
  const seeded = shuffle(players.map((p) => p.discord_id));
  const lengths = { semis: tournament.semis_best_of, final: tournament.final_best_of };
  if (format === "single_elim") {
    startTournament(tournament.id, format, seeded, singleElim(seeded, lengths), randomTeam());
  } else if (format === "round_robin") {
    startTournament(tournament.id, format, seeded, roundRobinPlan(seeded, lengths.final), randomTeam());
  } else {
    const { plan, groups } = groupsPlan(seeded, lengths);
    startTournament(tournament.id, format, seeded, plan, randomTeam(), groups);
  }

  await interaction.update(signupMessage(tournament, true));
  await announceLiveMatch(getLiveMatch(tournament.id)!);
}

async function askToCancel(interaction: ChatInputCommandInteraction<"cached">) {
  const open = getOpenTournament(interaction.guildId);
  if (!open) {
    await interaction.reply(ephemeral("No tournament is running."));
    return;
  }
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`tournament:cancel:${open.id}`).setLabel("Cancel tournament").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tournament:keep:${open.id}`).setLabel("Keep it").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content: `Cancel the current tournament (${open.status === "signup" ? "in signup" : "in progress"})? This can't be undone.`,
    components: [buttons],
    flags: MessageFlags.Ephemeral,
  });
}

/** Handles the private confirmation from /tournament cancel. */
async function confirmCancel(interaction: ButtonInteraction<"cached">, found: Tournament | null, confirmed: boolean) {
  if (!confirmed) {
    await interaction.update({ content: "Okay, the tournament continues.", components: [] });
    return;
  }
  if (!found || (found.status !== "signup" && found.status !== "active")) {
    await interaction.update({ content: "That tournament has already ended.", components: [] });
    return;
  }
  cancelTournament(found.id);
  await interaction.update({ content: "Cancelled.", components: [] });
  await tournamentChannel().send({
    content: `🛑 The tournament was cancelled by <@${interaction.user.id}>. Run \`/tournament start\` to begin a new one.`,
    allowedMentions: { parse: [] },
  });
}

export const tournament: Command = {
  data: new SlashCommandBuilder()
    .setName("tournament")
    .setDescription("Run a Rocket League 1v1 tournament")
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Open signup with Join and Start buttons")
        .addIntegerOption((o) => o.setName("semis").setDescription("Semifinal series length (default Bo1)").addChoices(...SERIES_CHOICES))
        .addIntegerOption((o) => o.setName("final").setDescription("Final series length (default Bo3)").addChoices(...SERIES_CHOICES)),
    )
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel the current tournament")),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    switch (interaction.options.getSubcommand()) {
      case "start":
        return start(interaction);
      case "cancel":
        return askToCancel(interaction);
    }
  },

  async button(interaction, [action, idArg]) {
    if (!interaction.inCachedGuild()) return;
    const found = getTournament(Number(idArg));
    if (action === "cancel" || action === "keep") return confirmCancel(interaction, found, action === "cancel");
    if (!found || found.status !== "signup") {
      await interaction.reply(ephemeral("Signup for this tournament is closed."));
      return;
    }
    if (action === "join") return join(interaction, found);
    if (action === "start") return begin(interaction, found);
  },
};
