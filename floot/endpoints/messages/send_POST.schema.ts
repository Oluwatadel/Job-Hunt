import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  conversationId: z.number().optional(),
  text: z.string().min(1),
  // From messages/upload: presign, PUT the bytes, then reference the file here.
  attachments: z
    .array(z.object({ storageFilename: z.string().min(1).max(300), contentType: z.string().min(1).max(100) }))
    .max(3)
    .optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  conversationId: number;
};

export const postMessagesSend = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/messages/send`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
