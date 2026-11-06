import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});
export type InputType = z.infer<typeof schema>;
export type OutputType = { success: true };

export const postAutomationsFulfill = async (
  body: InputType = {},
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await fetch(`/_api/automations/fulfill`, {
    method: "POST",
    body: superjson.stringify(schema.parse(body)),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};