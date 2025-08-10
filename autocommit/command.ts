import * as colors from "@std/fmt/colors";
import * as git from "~/lib/git.ts";
import { fetchAI } from "~/lib/openAI.ts";
import * as v from "~/lib/valibot.ts";
import instructions from "./prompt.md" with { type: "text" };
import { schema } from "./schema.ts";

export async function autocommit(verbosity = 0) {
  const status = await git.getStatus(verbosity >= 4);
  if (!status.trim()) {
    if (verbosity >= 1) {
      console.debug(colors.gray("[autocommit] No changes to commit."));
    }

    return;
  }

  const diff = await git.getDiff(verbosity >= 3);
  const head = await git.getHeadCommitMessage(verbosity >= 3);
  const logs = await git.getLogs(verbosity >= 3);
  const news = await git.getUntrackedFiles(verbosity >= 3);

  const prompt = `
# GIT STATUS:
${status.trim()}

# GIT DIFF:
${diff.trim()}

# UNTRACKED FILES:
${news.trim()}

# RECENT GIT LOGS:
${logs.trim()}

# CURRENT HEAD COMMIT MESSAGE:
${head.trim()}
`;

  const response = await fetchAI(
    prompt,
    instructions,
    v.json(schema),
    verbosity >= 4,
  );

  if (verbosity >= 2) {
    console.group("[autocommit] AI Response:");
    console.debug(colors.gray(JSON.stringify(response, null, 2)));
    console.groupEnd();
  }

  // Check if AI decided no meaningful commit can be made
  if (!response.files?.length || !response.commit_message) {
    if (verbosity >= 1) {
      console.debug(
        colors.gray(
          "[autocommit] No meaningful commit can be made, skipping.",
        ),
      );
    }

    return;
  }

  // Stage files for commit
  for (const { path, hunks } of response.files) {
    await git.addHunk(path, hunks);
  }

  await git.commit(response.commit_message, response.amend);

  if (verbosity >= 1) {
    console.group(`[autocommit] ${response.commit_message}`);

    if (verbosity >= 2) {
      for (const { path, hunks } of response.files) {
        if (!hunks?.length) {
          console.debug(colors.gray(`- ${path}`));
        } else {
          console.debug(
            colors.gray(
              `- ${path}:${
                hunks.map((hunk) => `${hunk.newStart}-${hunk.newEnd}`).join(",")
              }`,
            ),
          );
        }
      }
    }

    console.groupEnd();
  }
}
