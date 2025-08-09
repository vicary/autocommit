import * as v from "~/lib/valibot.ts";

export const schema = v.object({
  files: v.array(v.object({
    path: v.string(),
    hunks: v.optional(
      v.array(v.object({
        oldStart: v.number(),
        oldEnd: v.number(),
        newStart: v.number(),
        newEnd: v.number(),
      })),
    ),
  })),
  commit_message: v.optional(v.string()),
  amend: v.optional(v.boolean()),
});

export type AutocommitResponse = v.InferOutput<typeof schema>;
