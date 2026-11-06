import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});
export type InputType = z.infer<typeof schema>;
export type SupervisorConversation = {
  id: number;
  title: string | null;
  surface: string;
  handoffStatus: string; // 'ai' | 'human' |// handoffStatus: 'ai' (AI replies) | 'human' (a person replies) | 'closed'
  pendingQuestions: number; // open ask_supervisor questions — "needs attention"
  latestQuestion: string | null; // the newest pending question, for the list row
  status: string; // agent loop status (processing = AI mid-turn)
  updatedAt: Date;
};
export type OutputType = SupervisorConversation[];

export const getSupervisorConversations = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/supervisor/conversations`, { method: "GET", ...init });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
