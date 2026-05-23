import { PDFParse } from "pdf-parse";

export const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const parser = new PDFParse({ data: buffer });

  try {
    const parsedPdf = await parser.getText();

    return parsedPdf.text;
  } finally {
    await parser.destroy();
  }
};
