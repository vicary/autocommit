import * as git from "./git.ts";
import { runCommand } from "./runCommand.ts";

Deno.test("[rebase] should execute rebase plans", async () => {
  // Make 3 empty commits
  await runCommand("git", ["commit", "--allow-empty", "-m", "test a"]);
  await runCommand("git", ["commit", "--allow-empty", "-m", "test b"]);
  await runCommand("git", ["commit", "--allow-empty", "-m", "test c"]);

  const commits = await runCommand("git", [
    "log",
    "-n3",
    "--pretty=format:%H %s",
  ]).then((output) =>
    output
      .split("\n")
      .map((line) => line.split(" ")[0])
      .filter(Boolean)
      .toReversed()
  );

  // Rewords the 1st one, drop the 2nd one and squash the 3rd one.
  await git.rebase(
    [
      {
        action: "reword",
        commit: commits[0],
        message: "test d",
      },
      {
        action: "drop",
        commit: commits[1],
      },
      {
        action: "squash",
        commit: commits[2],
      },
    ],
    {
      verbose: true,
    },
  );
});
