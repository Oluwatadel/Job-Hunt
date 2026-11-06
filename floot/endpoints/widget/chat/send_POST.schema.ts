import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  text: z.string().min(1).max(4000),
  conversationId: z.number().int().positive().optional(), // omit -> this principal's thread (or a new one)
  // From widget/chat/upload: presign, PUT the bytes, then reference the file here.
  attachments: z
    .array(z.object({ storageFilename: z.string().min(1).max(300), contentType: z.string().min(1).max(100) }))
    .max(3)
    .optional(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { conversationId: number };

// Pass the widget session JWT (from widget/session) as a Bearer token.
export const postWidgetChatSend = async (
  body: InputType,
  sessionToken: string,
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await fetch(`/_api/widget/chat/send`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
