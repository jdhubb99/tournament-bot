import { expect, it } from "bun:test";
import { arg, cast, fakeInteraction } from "../test/helpers.ts";
import { ping } from "./ping.ts";

it("replies with the gateway latency", async () => {
  const interaction = fakeInteraction({ commandName: "ping" });
  await ping.execute(cast(interaction));
  expect(arg(interaction.reply)).toEqual({ content: "Pong! (42ms)" });
});
