import superjson from 'superjson';
import { Selectable } from "kysely";
import { Applications } from "../helpers/schema";

export type OutputType = Selectable<Applications>[];

export const getApplications = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/applications`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};