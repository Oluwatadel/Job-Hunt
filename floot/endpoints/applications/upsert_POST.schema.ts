import { z } from "zod";
import superjson from "superjson";
import { Selectable } from "kysely";
import { Applications, ApplicationStatusArrayValues } from "../../helpers/schema";

export const schema = z.object({
  docId: z.string().min(1),
  jobUrl: z.string().url().nullable().optional(),
  confirmation: z.string().nullable().optional(),
  company: z.string().min(1),
  role: z.string().min(1),
  source: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  dateApplied: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  status: z.enum(ApplicationStatusArrayValues),
  lastContact: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = Selectable<Applications>;

export const postApplicationsUpsert = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/applications/upsert`, {
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