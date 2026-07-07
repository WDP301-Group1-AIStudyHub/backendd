import { ExtractedDocument } from "./types";
import { convertToMarkdown } from "./markitdownService";
import { extractSemanticOutlineFromMarkdown } from "./outlineParser";

/**
 * Extracts content from a DOCX file using the MarkItDown FastAPI microservice.
 * Also parses headings from the resulting markdown to construct the semantic outline.
 */
export const extractDocxDocument = async (
  buffer: Buffer,
  fileName?: string,
): Promise<ExtractedDocument> => {
  const name = fileName || "document.docx";
  
  // Call MarkItDown microservice to convert DOCX to Markdown
  const markdownText = await convertToMarkdown(buffer, name);

  // Extract semantic outline (headings) from the Markdown text
  const semanticOutline = extractSemanticOutlineFromMarkdown(markdownText);

  return {
    extractedText: markdownText,
    metadata: {
      parser: "markitdown-docx",
      semanticOutline,
    },
  };
};
