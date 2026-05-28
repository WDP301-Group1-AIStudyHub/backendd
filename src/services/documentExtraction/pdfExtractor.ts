import { PDFParse } from "pdf-parse";
import { ExtractedDocument } from "./types";

export const extractPdfDocument = async (
  buffer: Buffer,
): Promise<ExtractedDocument> => {
  const parser = new PDFParse({ data: buffer });

  try {
    const parsedPdf = await parser.getText();

    return {
      extractedText: parsedPdf.text,
      metadata: {
        parser: "pdf-parse",
      },
    };
  } finally {
    await parser.destroy();
  }
};
