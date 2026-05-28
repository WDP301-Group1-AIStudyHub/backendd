import mammoth from "mammoth";
import { ExtractedDocument } from "./types";

export const extractDocxDocument = async (
  buffer: Buffer,
): Promise<ExtractedDocument> => {
  const result = await mammoth.extractRawText({ buffer });

  return {
    extractedText: result.value,
    metadata: {
      parser: "mammoth",
      warnings: result.messages.map((message) => message.message),
    },
  };
};
