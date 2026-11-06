import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  conversationId: z.number().int().positive(),
  text: z.string().min(1).max(10000),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { ok: boolean };

export const postSupervisorReply = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/supervisor/reply`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
