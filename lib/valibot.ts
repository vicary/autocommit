import * as v from "valibot";

export * from "valibot";

export const json = <
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema) =>
  v.pipe(
    v.string(),
    v.transform((v) => JSON.parse(v)),
    schema,
  );

export const base64 = <
  TSchema extends v.BaseSchema<string, unknown, v.BaseIssue<unknown>>,
>(schema: TSchema) =>
  v.pipe(
    v.string(),
    v.transform((v) => atob(v)),
    schema,
  );
