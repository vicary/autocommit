import { parseArgs } from "@std/cli";
import { autocommit } from "./autocommit/command.ts";
import { autorebase } from "./autorebase/command.ts";

async function main() {
  const { verbose: { length: verbosity } } = parseArgs(Deno.args, {
    boolean: ["verbose"],
    alias: { v: "verbose" },
    collect: ["verbose"],
  });

  await autocommit(verbosity);
  await autorebase(verbosity);
}

if (import.meta.main) {
  await main();
}
