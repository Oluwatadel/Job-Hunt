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
  storageFilename: string; // pass this (+ contentType) to widget/chat/send as an attachment
  expiresAt: Date;
};

// Pass the widget session JWT as a Bearer token.
export const postWidgetChatUpload = async (
  body: InputType,
  sessionToken: string,
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await fetch(`/_api/widget/chat/upload`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
