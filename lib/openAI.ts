import OpenAI from "@openai/openai";
import * as colors from "@std/fmt/colors";
import { ensureVariables } from "./env.ts";
import * as v from "./valibot.ts";

const {
  OPENAI_API_KEY,
  OPENAI_URI,
  OPENAI_MODEL = "sonar",
} = ensureVariables("OPENAI_API_KEY");

const client = new OpenAI({
  baseURL: OPENAI_URI,
  apiKey: OPENAI_API_KEY,
});

export async function fetchAI<
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(
  prompt: string,
  instruction: string,
  schema: TSchema,
  verbose = false,
): Promise<v.InferOutput<TSchema>> {
  if (verbose) {
    console.group(`AI Request:`);
    console.info(
      colors.gray(`Endpoint: ${colors.italic(OPENAI_URI ?? "(default)")}`),
    );
    console.info(colors.gray(`API Key: ${colors.italic(OPENAI_API_KEY)}`));
    console.info(colors.gray(`Model: ${colors.italic(OPENAI_MODEL)}`));
    console.info(colors.gray(`Prompt: ${colors.italic(prompt)}`));
    console.groupEnd();
  }

  const response: OpenAI.Chat.Completions.ChatCompletion = await client.chat
    .completions
    .create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: prompt },
      ],
    });

  if (verbose) {
    console.group("AI Response:");
    console.debug(colors.gray(JSON.stringify(response)));
    console.groupEnd();
  }

  let responseText = response.choices[0].message.content?.split("\n") ?? [];

  if (responseText[0]?.startsWith("```")) {
    responseText = responseText.slice(1);
  }

  if (responseText.at(-1)?.startsWith("```")) {
    responseText = responseText.slice(0, -1);
  }

  const validationResult = v.safeParse(
    schema,
    responseText.join("\n"),
  );

  if (!validationResult.success) {
    throw new Error(
      `Malformed AI response: ${JSON.stringify(validationResult.issues)}`,
    );
  }

  return validationResult.output;
}
