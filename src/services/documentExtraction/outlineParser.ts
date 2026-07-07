import { DocumentOutlineNode } from "../../utils/documentOutline";

/**
 * Parses markdown text to extract semantic headings (# through ######)
 * and construct outline nodes matching the schema.
 */
export function extractSemanticOutlineFromMarkdown(markdown: string): DocumentOutlineNode[] {
  console.log("[outlineParser] Extracting semantic outline from markdown text...");
  const nodes: DocumentOutlineNode[] = [];
  const lines = markdown.split(/\r?\n/);
  const headingRegex = /^(#{1,6})\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = headingRegex.exec(trimmed);
    if (match) {
      const hashes = match[1];
      const title = match[2].trim();

      if (!title) {
        continue;
      }

      nodes.push({
        id: `semantic-heading-${nodes.length + 1}`,
        parentId: null,
        level: hashes.length,
        type: "unknown",
        title,
        source: "semantic",
        confidence: 0.95,
      });
    }
  }

  console.log(`[outlineParser] Heading extraction completed. Found ${nodes.length} heading nodes.`);
  return nodes;
}
