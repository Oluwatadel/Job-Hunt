import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({});
export type InputType = z.infer<typeof schema>;

export type SupervisorQuestion = {
  id: number;
  conversationId: number;
  conversationTitle: string | null;
  question: string;
  status: string; // 'pending' | 'answered' | 'timed_out' | 'superseded' (human took over)
  answer: string | null;
  createdAt: Date;
  answeredAt: Date | null;
};
export type OutputType = SupervisorQuestion[];

export const getSupervisorQuestions = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/supervisor/questions`, { method: "GET", ...init });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
