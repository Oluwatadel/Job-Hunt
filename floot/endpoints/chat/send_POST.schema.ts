import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  text: z.string().min(1).max(10000),
  conversationId: z.number().int().positive().optional(), // omit -> your most recent thread (or a new one)
  newConversation: z.boolean().optional(), // true -> always start a fresh thread (the "New chat" button)
  // From chat/upload: presign, PUT the bytes, then reference the file here.
  attachments: z
    .array(z.object({ storageFilename: z.string().min(1).max(300), contentType: z.string().min(1).max(100) }))
    .max(3)
    .optional(),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { conversationId: number };

export const postChatSend = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/chat/send`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
