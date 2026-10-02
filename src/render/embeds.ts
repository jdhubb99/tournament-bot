import { EmbedBuilder } from "discord.js";

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

export function matchEmbed(opts: {
  label: string;
  bestOf: number;
  p1: EmbedPlayer;
  p2: EmbedPlayer;
  p1Wins: number;
  p2Wins: number;
  finished: boolean;
}): EmbedBuilder {
  const { p1, p2 } = opts;
  return new EmbedBuilder()
    .setColor(opts.finished ? GREEN : YELLOW)
    .setAuthor({ name: p1.name, iconURL: p1.avatarUrl })
    .setThumbnail(p2.avatarUrl)
    .setTitle(`${opts.label} — ${opts.finished ? "Finished" : "Live"}`)
    .setDescription(`<@${p1.id}> vs <@${p2.id}>`)
    .addFields(
      { name: "Series", value: `Best of ${opts.bestOf}`, inline: true },
      { name: "Score", value: `${p1.name} **${opts.p1Wins} – ${opts.p2Wins}** ${p2.name}`, inline: true },
    );
}
