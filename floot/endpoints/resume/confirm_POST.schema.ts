import { z } from "zod";
import superjson from "superjson";
import { ALLOWED_RESUME_CONTENT_TYPES } from "./presign_POST.schema";

export const schema = z.object({
  storageKey: z.string().trim().min(1).max(300),
  originalFilename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_RESUME_CONTENT_TYPES),
  sizeBytes: z.number().int().positive(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType =
  | { ok: true; filename: string; uploadedAt: Date }
  | { ok: false; error: string };

export const postResumeConfirm = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/resume/confirm`, {
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
