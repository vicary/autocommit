import * as v from "~/lib/valibot.ts";

export const schema = v.object({
  rebases: v.array(v.object({
    action: v.union([
      v.literal("drop"),
      v.literal("pick"),
      v.literal("reword"),
      v.literal("squash"),
    ]),
    commit: v.string(),
    message: v.optional(v.string()),
  })),
});

export type AutorebaseResponse = v.InferOutput<typeof schema>;
