import { z } from "zod";
import superjson from "superjson";
import { Selectable } from "kysely";
import { SubmittedLinks } from "../../helpers/schema";

export const schema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((v) => /^https?:\/\//i.test(v), {
      message: "Must be a full link starting with http:// or https://",
    }),
  note: z.string().trim().max(500).nullable().optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = Selectable<SubmittedLinks>;

export const postLinksSubmit = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/links/submit`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};