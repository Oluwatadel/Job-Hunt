import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  conversationId: z.number().int().positive(),
  status: z.enum(["ai", "human", "closed"]), // 'ai' hands back to the agent
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { ok: boolean };

export const postSupervisorHandoff = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/supervisor/handoff`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
