import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { announceLiveMatch, refreshBracketMessage } from "../announce.ts";
import { tournamentChannel } from "../channel.ts";
import { singleElim, type SeriesLengths } from "../logic/bracket.ts";
import { formatFor, MAX_PLAYERS, MIN_PLAYERS } from "../logic/format.ts";
import { groupsPlan } from "../logic/groups.ts";
import { shuffle } from "../logic/random.ts";
import { roundRobinPlan } from "../logic/roundrobin.ts";
import { checkLengthChange, stageOf, winsNeeded, type Stage } from "../logic/series.ts";
import { randomTeam } from "../logic/teams.ts";
import { signupEmbed } from "../render/embeds.ts";
import {
  addTournamentPlayer,
  cancelTournament,
  changeSeriesLengths,
  createTournament,
  getLiveMatch,
  getOpenTournament,
  getTournament,
  listGames,
  listMatches,
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
  // The live bracket first, so the "Up next" ping is the newest message.
  await refreshBracketMessage(tournament.id);
  await announceLiveMatch(getLiveMatch(tournament.id)!);
}

const STAGES = ["semis", "final"] as const;
const STAGE_NAMES: Record<Stage, string> = { semis: "Semifinals", final: "Final" };

const lengthName = (bestOf: number) => (bestOf === 1 ? "Bo1" : `Bo${bestOf} (first to ${winsNeeded(bestOf)})`);

/** Changes the semis and/or final length mid-signup or mid-tournament, keeping the seeding and every result. */
async function changeLengths(interaction: ChatInputCommandInteraction<"cached">) {
  const open = getOpenTournament(interaction.guildId);
  if (!open) {
    await interaction.reply(ephemeral("No tournament is running."));
    return;
  }
  const roundRobin = open.status === "active" && open.format === "round_robin";
  if (roundRobin && interaction.options.getInteger("semis") !== null) {
    await interaction.reply(ephemeral("This round robin has no semifinals, just the final."));
    return;
  }

  const current: SeriesLengths = { semis: open.semis_best_of, final: open.final_best_of };
  const changes: Partial<SeriesLengths> = {};
  for (const stage of STAGES) {
    const bestOf = interaction.options.getInteger(stage);
    if (bestOf !== null && bestOf !== current[stage]) changes[stage] = bestOf;
  }
  const changed = STAGES.filter((stage) => changes[stage] !== undefined);
  if (changed.length === 0) {
    const now = roundRobin
      ? `The final is Bo${current.final}.`
      : `The semis are Bo${current.semis} and the final is Bo${current.final}.`;
    await interaction.reply(ephemeral(`Nothing to change. ${now}`));
    return;
  }

  // Signup has no matches yet, so only the options change.
  const matches = listMatches(open.id);
  for (const stage of changed) {
    const inStage = matches.filter((m) => stageOf(m.label) === stage).map((m) => ({ ...m, games: listGames(m.id) }));
    const check = checkLengthChange(inStage, changes[stage]!);
    if (check.ok) continue;
    if (check.reason === "decided") {
      await interaction.reply(ephemeral(`${check.label} has already been decided, so the ${stage} length is locked.`));
    } else {
      const { p1Wins, p2Wins } = check.series;
      const standing = `${Math.max(p1Wins, p2Wins)}–${Math.min(p1Wins, p2Wins)}`;
      await interaction.reply(
        ephemeral(`${check.label} already stands at ${standing}, so a best of ${changes[stage]} would end it. Use \`/undo\` first to shorten it.`),
      );
    }
    return;
  }

  changeSeriesLengths(open.id, changes);
  const lines = changed.map((stage) => `${STAGE_NAMES[stage]}: Bo${current[stage]} → **${lengthName(changes[stage]!)}**`);
  await interaction.reply({
    content: [`🔧 <@${interaction.user.id}> changed the series length.`, ...lines].join("\n"),
    allowedMentions: { parse: [] },
  });
  if (open.status === "active") await refreshBracketMessage(open.id);
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
  if (found.status === "active") await refreshBracketMessage(found.id);
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
    .addSubcommand((sub) =>
      sub
        .setName("series")
        .setDescription("Change the semifinal or final series length of the current tournament")
        .addIntegerOption((o) => o.setName("semis").setDescription("New semifinal series length").addChoices(...SERIES_CHOICES))
        .addIntegerOption((o) => o.setName("final").setDescription("New final series length").addChoices(...SERIES_CHOICES)),
    )
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel the current tournament")),
  tournamentOnly: true,

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    switch (interaction.options.getSubcommand()) {
      case "start":
        return start(interaction);
      case "series":
        return changeLengths(interaction);
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
