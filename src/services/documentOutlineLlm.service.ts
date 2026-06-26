import { createHash } from "node:crypto";
import {
  DocumentOutlineNode,
  extractDocumentOutline,
} from "../utils/documentOutline";
import { generateGroqText } from "./groq.service";

type LlmOutlineCacheEntry = {
  hash: string;
  outline: DocumentOutlineNode[];
};

const outlineCache = new Map<string, LlmOutlineCacheEntry>();
const MAX_OUTLINE_TEXT_LENGTH = 12000;

const hashText = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseJsonObject = <T>(text: string): T | null => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
};

const isUsableTitle = (title: unknown, sourceText: string): title is string =>
  typeof title === "string" &&
  title.trim().length > 0 &&
  sourceText.toLowerCase().includes(title.trim().toLowerCase());

export const extractOutlineWithLlmFallback = async ({
  text,
  cacheKey,
}: {
  text: string;
  cacheKey: string;
}): Promise<DocumentOutlineNode[]> => {
  if (
    process.env.NODE_ENV === "test" ||
    !process.env.GROQ_API_KEY ||
    !text.trim()
  ) {
    return [];
  }

  const hash = hashText(text);
  const cached = outlineCache.get(cacheKey);

  if (cached?.hash === hash) {
    return cached.outline;
  }

  const sourceText = text.slice(0, MAX_OUTLINE_TEXT_LENGTH);

  try {
    const response = await generateGroqText(
      [
        {
          role: "system",
          content:
            "You extract document outlines for a RAG system. Return strict JSON only. Do not invent headings. Use exact heading text copied from the document.",
        },
        {
          role: "user",
          content: `Extract the document outline as JSON with this schema:
{"nodes":[{"level":1,"type":"part|chapter|section|subsection|appendix|unknown","title":"exact heading text","ordinal":"optional"}]}

Rules:
- Only include real body headings, not table-of-contents entries.
- If unsure, return {"nodes":[]}.
- Use exact title text found in the document.

Document:
${sourceText}`,
        },
      ],
      {
        temperature: 0,
        maxTokens: 1200,
      },
    );
    const parsed = parseJsonObject<{
      nodes?: Array<{
        level?: unknown;
        type?: unknown;
        title?: unknown;
        ordinal?: unknown;
      }>;
    }>(response);
    const semanticOutline: DocumentOutlineNode[] = (parsed?.nodes || [])
      .filter((node) => isUsableTitle(node.title, sourceText))
      .map((node, index) => ({
        id: `llm-outline-${index + 1}`,
        parentId: null,
        level:
          typeof node.level === "number" && node.level >= 1 && node.level <= 6
            ? node.level
            : 3,
        type:
          node.type === "part" ||
          node.type === "chapter" ||
          node.type === "section" ||
          node.type === "subsection" ||
          node.type === "appendix" ||
          node.type === "unknown"
            ? node.type
            : "unknown",
        title: node.title as string,
        ordinal: typeof node.ordinal === "string" ? node.ordinal : undefined,
        source: "llm",
        confidence: 0.72,
      }));
    const outline = extractDocumentOutline({
      text,
      semanticOutline,
    });

    outlineCache.set(cacheKey, { hash, outline });

    return outline;
  } catch (error) {
    console.warn("[Document structure] LLM outline extraction skipped", {
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });

    return [];
  }
};
