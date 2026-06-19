import mammoth from "mammoth";
import { ExtractedDocument } from "./types";
import type { DocumentOutlineNode } from "../../utils/documentOutline";

const HTML_HEADING_PATTERN = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripHtml = (value: string): string =>
  decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const extractSemanticOutlineFromHtml = (html: string): DocumentOutlineNode[] => {
  const nodes: DocumentOutlineNode[] = [];
  let match: RegExpExecArray | null;

  while ((match = HTML_HEADING_PATTERN.exec(html)) !== null) {
    const title = stripHtml(match[2]);

    if (!title) {
      continue;
    }

    nodes.push({
      id: `semantic-heading-${nodes.length + 1}`,
      parentId: null,
      level: Number(match[1]),
      type: "unknown",
      title,
      source: "semantic",
      confidence: 0.95,
    });
  }

  return nodes;
};

export const extractDocxDocument = async (
  buffer: Buffer,
): Promise<ExtractedDocument> => {
  const [rawTextResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);
  const semanticOutline = extractSemanticOutlineFromHtml(htmlResult.value);

  return {
    extractedText: rawTextResult.value,
    metadata: {
      parser: "mammoth",
      semanticOutline,
      warnings: [...rawTextResult.messages, ...htmlResult.messages].map(
        (message) => message.message,
      ),
    },
  };
};
