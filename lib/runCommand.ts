import * as colors from "@std/fmt/colors";

export async function runCommand(
  cmd: string,
  args: string[],
  verbose = false,
  env?: Record<string, string>,
): Promise<string> {
  const command = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
    env,
  });

  const { code, stdout, stderr } = await command.output();
  const stdoutText = new TextDecoder().decode(stdout);
  const stderrText = new TextDecoder().decode(stderr);

  if (code !== 0) {
    console.error(
      `Command "${cmd} ${args.join(" ")}" failed with code ${code}:`,
    );
    console.error(stderrText);
    throw new Error(`Command failed with exit code ${code}`);
  }

  if (verbose && stdoutText.trim()) {
    console.log(`> ${cmd} ${args.join(" ")}`);
    console.log(colors.gray(stdoutText));
  }

  return stdoutText;
}
