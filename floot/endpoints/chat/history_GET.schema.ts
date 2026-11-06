import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});
export type InputType = z.infer<typeof schema>;
export type ChatMessage = {
  id: number;
  sender: "user" | "assistant" | "human_agent";
  senderName: string | null; // set for human_agent replies
  text: string;
  attachments: { url: string; type: "image" | "pdf" }[]; // presigned (~24h); images inline, PDFs as links
  createdAt: Date;
};
// handoffStatus: 'ai' (AI replies) | 'human' (a person replies) | 'closed'|// handoffStatus: 'ai' (AI replies) | 'human' (a person replies) | 'closed'|// handoffStatus: 'ai' (AI replies) | 'human' (a person replies) | 'closed'|// handoffStatus: 'ai' (AI replies) | 'human' (a person replies) | 'closed'
export type OutputType = { status: string; handoffStatus: string; messages: ChatMessage[] };

export const getChatHistory = async (
  params: { conversationId: number; sinceId?: number },
  init?: RequestInit,
): Promise<OutputType> => {
  const qs = new URLSearchParams({ conversationId: String(params.conversationId) });
  if (params.sinceId) qs.set("sinceId", String(params.sinceId));
  const result = await fetch(`/_api/chat/history?${qs}`, { method: "GET", ...init });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
