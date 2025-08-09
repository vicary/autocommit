import * as colors from "@std/fmt/colors";
import * as git from "~/lib/git.ts";
import { fetchAI } from "~/lib/openAI.ts";
import * as v from "~/lib/valibot.ts";
import instructions from "./prompt.md" with { type: "text" };
import { schema } from "./schema.ts";

export async function autorebase(verbosity = 0) {
  const unpushedCommits = await git.getUnpushedCommits(verbosity >= 4);
  if (!unpushedCommits.trim()) {
    if (verbosity >= 1) {
      console.debug(colors.gray("[autocommit] Nothing to rebase, skipping."));
    }

    return false;
  }

  const prompt = `
UNPUSHED COMMITS:
${unpushedCommits}
`;

  const response = await fetchAI(
    prompt,
    instructions,
    v.json(schema),
    verbosity >= 4,
  );

  if (verbosity >= 2) {
    console.group("[autorebase] AI Response:");
    console.debug(colors.gray(JSON.stringify(response, null, 2)));
    console.groupEnd();
  }

  // Check if AI decided no rebase is needed
  if (!response.rebases?.length) {
    if (verbosity >= 1) {
      console.debug(colors.gray("[autorebase] No rebase needed."));
    }

    return;
  }

  await git.rebase(response.rebases);

  return;
}
