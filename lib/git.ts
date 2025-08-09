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
    ["log", "-n", "10", "--pretty=format:%H %s"],
    verbose,
  );
}

export async function getUnpushedCommits(verbose = false): Promise<string> {
  try {
    return await runCommand(
      "git",
      ["log", "-p", "@{u}..HEAD", "--pretty=format:%H %s"],
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

export async function rebase(plans: AutorebaseResponse["rebases"]) {
  // [ ] Debug only,  remove afterwards
  if (1) {
    console.log({ plans });
    return;
  }

  if (!plans.length) return;

  // Map for quick lookup of desired action/message
  const planBySha = new Map<string, { action: string; message?: string }>();
  for (const p of plans) {
    planBySha.set(p.commit, { action: p.action, message: p.message });
  }

  // Gather full HEAD linear history (oldest → newest)
  const fullListRaw = await runCommand(
    "git",
    ["rev-list", "--reverse", "--topo-order", "HEAD"],
  );
  const fullList = fullListRaw.trim().split("\n").filter(Boolean);

  // Order of commits user wants (the array order is treated as final order for those commits)
  const desiredOrder = plans.map((p) => p.commit);

  // Find earliest (in current history) commit we touch
  let earliestIndex = Infinity;
  for (const sha of desiredOrder) {
    const idx = fullList.indexOf(sha);
    if (idx === -1) {
      throw new Error(`Commit ${sha} not found on current branch`);
    }
    if (idx < earliestIndex) earliestIndex = idx;
  }
  if (!isFinite(earliestIndex)) return;

  const firstTouched = fullList[earliestIndex];

  // Base is parent of earliest touched commit (or --root if none)
  let baseParent: string | null = null;
  try {
    baseParent = (await runCommand("git", ["rev-parse", `${firstTouched}^`]))
      .trim();
  } catch {
    baseParent = null; // Root commit case
  }

  // Current commits from earliest touched → HEAD in existing order
  const affectedTail = fullList.slice(earliestIndex);

  // Reconstruct final sequence:
  // - Commits we have a plan for appear in desiredOrder (excluding dropped)
  // - Commits after earliest touched that are NOT in plans remain in their original relative order after all planned ones unless already listed.
  const plannedSet = new Set(desiredOrder);
  const droppedSet = new Set(
    plans.filter((p) => p.action === "drop").map((p) => p.commit),
  );

  // Filter desired order to exclude dropped
  const reordered = desiredOrder.filter((sha) => !droppedSet.has(sha));

  // Append untouched commits (not in plans) preserving order
  for (const sha of affectedTail) {
    if (!plannedSet.has(sha)) reordered.push(sha);
  }

  // Build todo lines
  const todoLines: string[] = [];
  for (const sha of reordered) {
    const plan = planBySha.get(sha);
    // Get subject for display (fallback to SHA if fails)
    let subject = "";
    try {
      subject = (await runCommand("git", ["show", "-s", "--format=%s", sha]))
        .trim();
    } catch {
      subject = sha.slice(0, 7);
    }

    if (!plan) {
      // Not modified: keep as pick
      todoLines.push(`pick ${sha} ${subject}`);
      continue;
    }

    if (plan.action === "pick") {
      todoLines.push(`pick ${sha} ${plan.message ?? subject}`);
    } else if (plan.action === "squash") {
      // First occurrence of a squash target must have a preceding pick of the commit it merges into.
      // Simplicity: treat this commit as squash onto previous commit in reordered list.
      // If it is first, fallback to pick (cannot squash without a previous commit).
      if (todoLines.length === 0) {
        todoLines.push(`pick ${sha} ${plan.message ?? subject}`);
      } else {
        // Use squash; Git will open editor unless we auto-close it.
        todoLines.push(`squash ${sha} ${plan.message ?? subject}`);
      }
    } else {
      // drop already removed from 'reordered'; ignore
    }
  }

  if (!todoLines.length) {
    return;
  }

  const todoContent = todoLines.join("\n") + "\n";

  // Prepare a temp file with the todo
  const tempTodo = await Deno.makeTempFile();
  await Deno.writeTextFile(tempTodo, todoContent);

  // Sequence editor: overwrite the file Git provides ($1) with our prepared todo
  // Using a small shell script via sh -c
  const sequenceEditor = `sh -c 'cat "${tempTodo}" > "$1"'`;

  const env = {
    ...Deno.env.toObject(),
    GIT_SEQUENCE_EDITOR: sequenceEditor,
    GIT_EDITOR: "true", // auto-accept combined squash messages
  };

  const rebaseArgs = baseParent
    ? ["rebase", "-i", baseParent]
    : ["rebase", "-i", "--root"];

  try {
    await runCommand("git", rebaseArgs, false, env);
  } finally {
    await Deno.remove(tempTodo).catch(() => {});
  }
}
