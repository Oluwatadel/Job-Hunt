import superjson from "superjson";

export type OutputType =
  | { exists: false }
  | {
      exists: true;
      filename: string;
      contentType: string;
      sizeBytes: number;
      uploadedAt: Date;
      viewUrl: string;
    };

export const getResume = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/resume`, {
    method: "GET",
    ...init,
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
