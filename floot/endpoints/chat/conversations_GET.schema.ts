import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});
export type InputType = z.infer<typeof schema>;
export type ChatConversation = {
  id: number; title: string | null; status: string; createdAt: Date; updatedAt: Date;
};
export type OutputType = ChatConversation[];

export const getChatConversations = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/chat/conversations`, { method: "GET", ...init });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
