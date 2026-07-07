import { ExtractedDocument } from "./types";
import { convertToMarkdown } from "./markitdownService";
import { extractSemanticOutlineFromMarkdown } from "./outlineParser";

/**
 * Extracts content from a PDF file using the MarkItDown FastAPI microservice.
 * Converts PDF to Markdown and parses headings to construct the semantic outline.
 */
export const extractPdfDocument = async (
  buffer: Buffer,
  fileName?: string,
): Promise<ExtractedDocument> => {
  const name = fileName || "document.pdf";

  // Call MarkItDown microservice to convert PDF to Markdown
  const markdownText = await convertToMarkdown(buffer, name);

  // Extract semantic outline (headings) from the Markdown text
  const semanticOutline = extractSemanticOutlineFromMarkdown(markdownText);

  return {
    extractedText: markdownText,
    metadata: {
      parser: "markitdown-pdf",
      semanticOutline,
    },
  };
};
