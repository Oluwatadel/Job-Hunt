import superjson from "superjson";

export type OutputType =
  | { ok: true; pending: true; requestedAt: string; alreadyPending: boolean }
  | { ok: false; error: string; retryAfterMinutes: number };

export const postAutomationsRequest = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/automations/request`, { method: "POST", ...init });
  return superjson.parse<OutputType>(await result.text());
};