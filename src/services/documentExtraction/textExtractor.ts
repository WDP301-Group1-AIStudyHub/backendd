import { ExtractedDocument } from "./types";

export const extractTextDocument = async (
  buffer: Buffer,
): Promise<ExtractedDocument> => ({
  extractedText: buffer.toString("utf8"),
  metadata: {
    parser: "buffer-utf8",
  },
});
