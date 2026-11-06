import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  questionId: z.number().int().positive(),
  answer: z.string().min(1).max(4000),
});
export type InputType = z.infer<typeof schema>;
export type OutputType = { ok: boolean; message: string };

export const postSupervisorAnswer = async (
  body: InputType,
  init?: RequestInit,
): Promise<OutputType> => {
  const result = await fetch(`/_api/supervisor/answer`, {
    method: "POST",
    body: superjson.stringify(body),
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!result.ok) throw new Error(superjson.parse<{ error: string }>(await result.text()).error);
  return superjson.parse<OutputType>(await result.text());
};
