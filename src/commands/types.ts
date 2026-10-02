import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  /** Only usable in #tournaments; elsewhere the user gets a private redirect. */
  tournamentOnly?: boolean;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Handles buttons whose customId starts with `<command name>:`. */
  button?(interaction: ButtonInteraction, args: string[]): Promise<void>;
}
