import superjson from "superjson";

export type OutputType = {
  pending: boolean;
  requestedAt: string | null;
  fulfilledAt: string | null;
  lastRequestedAt: string | null;
};

export const getAutomationsStatus = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/automations/status`, { method: "GET", ...init });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};