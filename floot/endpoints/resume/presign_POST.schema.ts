import { z } from "zod";
import superjson from "superjson";

// Only formats that make sense as a resume AND aren't rejected by storage's
// own HTML/JS/XML block. Kept deliberately narrow - this is a document
// upload, not a general file box.
export const ALLOWED_RESUME_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024; // 10MB - plenty for a resume, well under storage's own 100MB cap

export const schema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_RESUME_CONTENT_TYPES),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_RESUME_SIZE_BYTES, "Resume file is too large (10MB limit)"),
});

export type InputType = z.infer<typeof schema>;

export type OutputType =
  | { ok: true; storageKey: string; presignedUrl: string; headers: Record<string, string> }
  | { ok: false; error: string };

export const postResumePresign = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/resume/presign`, {
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
