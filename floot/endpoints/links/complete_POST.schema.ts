import { z } from "zod";
import superjson from "superjson";
import { Selectable } from "kysely";
import { SubmittedLinks } from "../../helpers/schema";

export const schema = z.object({
  id: z.union([z.string(), z.number()]),
  status: z.enum(["processed", "skipped", "error"]),
  resultDocId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = Selectable<SubmittedLinks>;

export const postLinksComplete = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/links/complete`, {
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