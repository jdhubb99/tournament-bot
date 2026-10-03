import { deployCommands, scopeFromArgs } from "./deploy.ts";

await deployCommands(scopeFromArgs(Bun.argv));
