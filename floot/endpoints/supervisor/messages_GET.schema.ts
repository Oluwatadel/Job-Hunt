import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});
export type InputType = z.infer<typeof schema>;
export type SupervisorMessage = {
  id: number;
  sender: "user" | "assistant" | "human_agent";
  senderName: string | null;
  text: string;
  attachments: { url: string; type: "image" | "pdf" }[];
  createdAt: Date;
};
export type OutputType = { status: string; handoffStatus: string; messages: SupervisorMessage[] };

export const getSupervisorMessages = async (
  params: { conversationId: number; sinceId?: number },
  init?: RequestInit,
): Promise<OutputType> => {
  const qs = new URLSearchParams({ conversationId: String(params.conversationId) });
  if (params.sinceId) qs.set("sinceId", String(params.sinceId));
  const result = await fetch(`/_api/supervisor/messages?${qs}`, { method: "GET", ...init });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
