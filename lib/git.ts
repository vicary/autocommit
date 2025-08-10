import * as colors from "@std/fmt/colors";
import { ulid } from "@std/ulid";
import { AutorebaseResponse } from "../autorebase/schema.ts";
import { runCommand } from "./runCommand.ts";

export async function getStatus(verbose = false): Promise<string> {
  return await runCommand("git", ["status", "--porcelain"], verbose);
}

export async function getDiff(verbose = false): Promise<string> {
  return await runCommand("git", ["diff"], verbose);
}

export async function getUntrackedFiles(verbose = false): Promise<string> {
  const files = await runCommand("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
  ], verbose)
    .then((output) => output.split("\n").filter(Boolean));

  let result = "";

  for (const file of files) {
    result += `${file}:\n`;

    if (await isBinaryFile(file)) {
      result += "(binary file)\n";
    } else {
      const contents = await Deno.readTextFile(file);

      result += "```\n";
      result += contents.replace(/```/g, "``\\`") + "\n";
      result += "```\n\n";
    }
  }

  return result;
}

async function isBinaryFile(file: string): Promise<boolean> {
  const fd = await Deno.open(file);
  const buffer = new Uint8Array(512);
  await fd.read(buffer);
  fd.close();
  return buffer.length > 0 &&
    !new TextDecoder().decode(buffer).includes("\n");
}

export async function getLogs(verbose = false): Promise<string> {
  return await runCommand(
    "git",
    ["log", "-n10", "--pretty=format:%H %s"],
    verbose,
  );
}

export async function getUnpushedCommits(verbose = false): Promise<string> {
  try {
    return await runCommand(
      "git",
      ["log", "-p", "--pretty=format:%H %s", "@{u}..HEAD"],
      verbose,
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    // If there's no upstream branch, return empty string
    if (error.message.includes("no upstream configured")) {
      return "";
    }

    throw error;
  }
}

export async function getHeadCommitMessage(verbose = false): Promise<string> {
  try {
    return await runCommand("git", ["log", "-1", "--pretty=%B"], verbose);
  } catch (error) {
    if (!(error instanceof Error)) throw error;

    if (error.message.includes("does not have any commits yet")) {
      return ""; // Repository is empty
    }
    throw error;
  }
}

export async function addHunk(
  file: string,
  hunks?: Array<{
    oldStart: number;
    oldEnd: number;
    newStart: number;
    newEnd: number;
  }>,
): Promise<void> {
  if (!hunks?.length) {
    await runCommand("git", ["add", file]);
    return;
  }

  console.debug(`Adding hunk for file ${file}: ${JSON.stringify(hunks)}`);

  const tempFile = await Deno.makeTempFile();

  // Read "old" content from the index (may differ from HEAD if partially staged already)
  const oldLines = await runCommand("git", ["show", `:${file}`])
    .catch(
      (e) => {
        // File may be untracked (treat as empty old content)
        if (!(e instanceof Error) || !e.message.includes("fatal: Path")) {
          throw e;
        }
      },
    )
    .then((output) => output?.trim().split("\n") ?? []);

  const newContent = await Deno.readTextFile(file);
  const newLines = newContent.split("\n");

  // Build patch
  const isNewFile = oldLines.length === 0;
  const headerOld = isNewFile ? "/dev/null" : `a/${file}`;
  const headerNew = `b/${file}`;

  const body = hunks
    ?.map(({ oldStart, oldEnd, newStart, newEnd }) => {
      // Slice the specified ranges (1-based inclusive)
      const oldSlice = oldStart > 0 && oldEnd >= oldStart
        ? oldLines.slice(oldStart - 1, oldEnd)
        : [];
      const newSlice = newStart > 0 && newEnd >= newStart
        ? newLines.slice(newStart - 1, newEnd)
        : [];

      const oldLen = oldSlice.length;
      const newLen = newSlice.length;

      // Build diff body line-by-line (simple pairwise; does not compute LCS)
      // For more accurate diffs, integrate a diff algorithm.
      let diffBody = "";
      const maxLen = Math.max(oldLen, newLen);
      for (let i = 0; i < maxLen; i++) {
        const o = oldSlice[i];
        const n = newSlice[i];
        if (o === undefined && n !== undefined) {
          diffBody += `+${n}\n`;
        } else if (o !== undefined && n === undefined) {
          diffBody += `-${o}\n`;
        } else if (o !== n) {
          if (o !== undefined) diffBody += `-${o}\n`;
          if (n !== undefined) diffBody += `+${n}\n`;
        } else {
          diffBody += ` ${o}\n`;
        }
      }

      // Hunk header: if length == 1 still keep ,<len> for consistency
      const oldMeta = isNewFile && oldLen === 0
        ? `${oldStart},0`
        : `${oldStart},${oldLen}`;
      const newMeta = `${newStart},${newLen}`;
      return `@@ -${oldMeta} +${newMeta} @@\n${diffBody}`;
    })
    .join("\n") ?? "";

  const patch = `diff --git a/${file} b/${file}
${isNewFile ? "new file mode 100644\n" : ""}
--- ${headerOld}
+++ ${headerNew}
${body}`.replace(/\n+$/, "") + "\n";

  await Deno.writeTextFile(tempFile, patch);
  await runCommand("git", ["apply", "--cached", tempFile]);
  await Deno.remove(tempFile);
}

export async function commit(message: string, amend = false): Promise<void> {
  const args = ["commit", "-m", message];
  if (amend) {
    args.push("--amend", "--no-edit");
  }

  await runCommand("git", args);
}

export async function rebase(
  actions: AutorebaseResponse["rebases"],
  options?: { verbose?: boolean },
) {
  console.debug(actions);

  if (!actions.length) return;

  // From earliest affected commit to HEAD
  const rebaseRange = await runCommand("git", [
    // "rev-list",
    // "--reverse",
    // "--topo-order",
    "log",
    "--pretty=format:%H %s",
    "@{u}..HEAD",
  ])
    .then((output) => {
      const list = output.split("\n").filter(Boolean).toReversed().map(
        (line) => {
          const [hash, ...messageParts] = line.split(" ");
          const message = messageParts.join(" ");
          return [hash, message] as const;
        },
      );
      const rebaseRootIndex = Math.min(
        ...actions.map(({ commit }) =>
          list.findIndex(([sha]) => sha === commit)
        ),
      );

      if (rebaseRootIndex < 0) {
        return;
      }

      return list.slice(rebaseRootIndex);
    });

  if (!rebaseRange) {
    console.group(
      colors.red(`[autorebase] Suggested rebase hash not found.`),
    );
    for (const { commit } of actions) {
      console.debug(colors.gray(`- ${commit}`));
    }
    console.groupEnd();
    return;
  }

  if (rebaseRange.length <= 1) {
    console.info(
      colors.gray(`[autorebase] Plan contains less than 2 steps, skipping.`),
    );
    return;
  }

  // Base is parent of earliest touched commit (or --root if none)
  const rebaseParent = await runCommand("git", [
    "rev-parse",
    `${rebaseRange[0][0]}^`,
  ]).then(
    (output) => output.trim(),
    () => null,
  );

  const rebaseSequence = new Map<string, string>();

  {
    const rebaseSet = new Map(rebaseRange);

    for (const plan of actions) {
      // No need to assert hash existence after rebaseRootIndex check.
      rebaseSet.delete(plan.commit);

      let message = plan.message ||
        await runCommand("git", ["show", "-s", "--format=%s", plan.commit]);

      message = message.trim() || ulid();

      switch (plan.action) {
        case "pick": {
          rebaseSequence.set(plan.commit, `p ${plan.commit} ${message}`);
          break;
        }
        case "reword": {
          rebaseSequence.set(plan.commit, `r ${plan.commit} ${message}`);
          // [ ] Find ways to bypass interactive reword session
          break;
        }
        case "drop": {
          // rebaseSequence.set(plan.commit, `d ${plan.commit} ${message}`);
          break;
        }
        case "squash": {
          rebaseSequence.set(
            plan.commit,
            rebaseSequence.size || rebaseParent
              ? `s ${plan.commit} ${message}`
              : `p ${plan.commit} ${message}`,
          );
          break;
        }
      }
    }

    if (rebaseSet.size) {
      // For sloppy LLM responses, append untouched commits to the end.
      if (options?.verbose) {
        console.group(
          colors.red(
            `[autorebase] Sloppy AI left untouched commits in-between, appending to the end:`,
          ),
        );
        for (const [hash] of rebaseSet) {
          console.debug(colors.gray(`- ${hash}`));
        }
        console.groupEnd();
      }

      for (const [hash, message] of rebaseSet) {
        rebaseSequence.set(hash, `p ${hash} ${message}`);
      }
    }
  }

  const todoContents = Array.from(rebaseSequence.values()).join("\n") + "\n";

  if (options?.verbose) {
    console.group(
      `[autorebase] Applying rebase sequence upon ${rebaseParent ?? "--root"}:`,
    );
    console.debug(colors.gray(todoContents));
    console.groupEnd();
  }

  // Prepare a temp file with the todo
  const todoFile = await Deno.makeTempFile();

  try {
    await Deno.writeTextFile(todoFile, todoContents);

    await runCommand(
      "git",
      ["rebase", "-i", rebaseParent ?? "--root"],
      options?.verbose,
      {
        ...Deno.env.toObject(),

        // Sequence editor: overwrite the file Git provides ($1) with only the
        // first (top) contiguous block of command lines from our prepared todo,
        // dropping anything after the first blank line (e.g. extra duplicated sections)
        GIT_SEQUENCE_EDITOR:
          `sh -c 'awk "NF==0{exit} {print}" "${todoFile}" > "$0"'`,

        // auto-accept combined squash messages
        GIT_EDITOR: "true",
      },
    );
  } finally {
    await Deno.remove(todoFile).catch(() => {});
  }
}
