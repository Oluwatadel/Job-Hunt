import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = {
  presignedUrl: string; // PUT the file bytes here with header Content-Type
  url: string;          // read URL (24h) — for a local preview
  storageFilename: string; // pass this (+ contentType) to messages/send as an attachment
  expiresAt: Date;
};

export const postMessagesUpload = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/messages/upload`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
