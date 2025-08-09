import { loadSync } from "@std/dotenv";
import { underline } from "@std/fmt/colors";

let envLoaded = false;

export const ensureVariables = <T extends string>(...keys: T[]) => {
  if (!envLoaded) {
    loadSync({ export: true });
    envLoaded = true;
  }

  const env = Deno.env.toObject();

  const missingKeys = keys.sort().filter((key) => !env[key]?.trim());
  if (missingKeys.length > 0) {
    throw new ReferenceError(
      `Invalid application environment, required variable(s): ${
        keys
          .map((key) => (missingKeys.includes(key) ? underline(key) : key))
          .join(", ")
      }`,
    );
  }

  return env as Record<T, string> & Record<string, string | undefined>;
};
