import superjson from 'superjson';
import { Selectable } from "kysely";
import { SubmittedLinks } from "../helpers/schema";

export type OutputType = Selectable<SubmittedLinks>[];

export const getLinks = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/links`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};