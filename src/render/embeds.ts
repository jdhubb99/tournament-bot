import { EmbedBuilder } from "discord.js";
import { VERSUS_FILE } from "./versus-image.ts";

const YELLOW = 0xf1c40f;
const GREEN = 0x2ecc71;
const BLURPLE = 0x5865f2;

export interface EmbedPlayer {
  id: string;
  name: string;
  avatarUrl: string;
}

export function signupEmbed(opts: {
  players: { discord_id: string }[];
  semisBestOf: number;
  finalBestOf: number;
  maxPlayers: number;
  closed: boolean;
}): EmbedBuilder {
  const list = opts.players.length
    ? opts.players.map((p, i) => `${i + 1}. <@${p.discord_id}>`).join("\n")
    : "_No one yet_";
  return new EmbedBuilder()
    .setColor(opts.closed ? GREEN : BLURPLE)
    .setTitle(opts.closed ? "Rocket League 1v1 — Signup closed" : "Rocket League 1v1 — Signup open")
    .setDescription(opts.closed ? "The tournament has started. Good luck!" : "Click **Join** to play. Click **Start** once everyone's in.")
    .addFields(
      { name: `Players (${opts.players.length}/${opts.maxPlayers})`, value: list },
      { name: "Series", value: `Semis Bo${opts.semisBestOf} · Final Bo${opts.finalBestOf}` },
    );
}

/**
 * Live: yellow, with both avatars in the attached versus image (see versus-image.ts).
 * Decided: green, showing only the winner's avatar.
 */
export function matchEmbed(opts: {
  label: string;
  bestOf: number;
  p1: EmbedPlayer;
  p2: EmbedPlayer;
  p1Wins: number;
  p2Wins: number;
  winnerId?: string | null;
}): EmbedBuilder {
  const { p1, p2 } = opts;
  const winner = [p1, p2].find((p) => p.id === opts.winnerId);
  const embed = new EmbedBuilder()
    .setDescription(`<@${p1.id}> vs <@${p2.id}>`)
    .addFields(
      { name: "Series", value: `Best of ${opts.bestOf}`, inline: true },
      { name: "Score", value: `${p1.name} **${opts.p1Wins} – ${opts.p2Wins}** ${p2.name}`, inline: true },
    );
  if (winner) {
    return embed.setColor(GREEN).setTitle(`${opts.label} — ${winner.name} wins`).setThumbnail(winner.avatarUrl);
  }
  return embed.setColor(YELLOW).setTitle(`${opts.label} — Live`).setImage(`attachment://${VERSUS_FILE}`);
}
