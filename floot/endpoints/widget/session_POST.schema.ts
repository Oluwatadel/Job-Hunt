// endpoints/widget/session_POST.schema.ts
import { z } from "zod";

// Discriminated on `kind`. Anonymous needs only a client-generated token;
// identified needs the externalUserId, the HMAC signature the embedding site
// produced, and issuedAt (REQUIRED — it binds the signature to the 5-minute replay
// window; without it a captured signature is replayable forever). name/email are
// optional display fields.
export const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anonymous"),
    token: z.string().min(8).max(200),
    // SELF-ASSERTED display fields (a pre-chat "your name/email" form). Shown to
    // supervisors and used for the thread label ONLY — never for authorization or
    // data lookups (anyone can type any name; only the HMAC "identified" path is
    // a verified identity).
    name: z.string().max(200).optional(),
    email: z.string().email().max(320).optional(),
  }),
  z.object({
    kind: z.literal("identified"),
    externalUserId: z.string().min(1).max(200),
    signature: z.string().min(1).max(512),
    issuedAt: z.number(),
    name: z.string().max(200).optional(),
    email: z.string().email().max(320).optional(),
  }),
]);

export type InputType = z.infer<typeof schema>;

export type OutputType = {
  sessionToken: string;
};
