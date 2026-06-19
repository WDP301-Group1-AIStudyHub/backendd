import type { ChunkingResult, DocumentChunk } from "./textSplitter";
import { normalizeForQuestionMatching } from "./answerProfile";

export type DocumentOutlineNodeType =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "appendix"
  | "toc_entry"
  | "unknown";

export type DocumentOutlineSource =
  | "semantic"
  | "layout"
  | "text"
  | "chunk"
  | "llm";

export interface DocumentOutlineNode {
  id: string;
  parentId?: string | null;
  level: number;
  type: DocumentOutlineNodeType;
  title: string;
  ordinal?: string;
  pageStart?: number;
  pageEnd?: number;
  textStart?: number;
  textEnd?: number;
  source: DocumentOutlineSource;
  confidence: number;
}

export interface ExtractDocumentOutlineInput {
  text: string;
  chunkingResult?: ChunkingResult;
  semanticOutline?: DocumentOutlineNode[];
}

const ROMAN_VALUES: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

const STRUCTURE_HEADING_PATTERN =
  /^(chuong|chapter|phan|part|muc|section|appendix|phu luc|bai)\s+([0-9]+(?:\.[0-9]+)*|[ivxlcdm]+)?(?:\s*[:.-]\s*|\s+)?(.*)$/i;
const NUMBERED_HEADING_PATTERN = /^([0-9]+(?:\.[0-9]+)+)\.?\s+(.+)$/;
const GENERAL_CONTENT_TITLE = "General Content";

const slugify = (value: string): string =>
  normalizeForQuestionMatching(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const uniqueBy = <T>(items: T[], getKey: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  items.forEach((item) => {
    const key = getKey(item);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });

  return result;
};

const romanToNumber = (value: string): number | undefined => {
  const normalized = value.toLowerCase();

  if (!/^[ivxlcdm]+$/.test(normalized)) {
    return undefined;
  }

  let total = 0;
  let previous = 0;

  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const current = ROMAN_VALUES[normalized[index]];

    if (!current) {
      return undefined;
    }

    if (current < previous) {
      total -= current;
    } else {
      total += current;
      previous = current;
    }
  }

  return total > 0 ? total : undefined;
};

const ordinalSortValue = (ordinal: string | undefined): number | undefined => {
  if (!ordinal) {
    return undefined;
  }

  const numeric = Number(ordinal);

  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  return romanToNumber(ordinal);
};

const normalizeOrdinal = (ordinal: string | undefined): string | undefined => {
  if (!ordinal) {
    return undefined;
  }

  const numeric = ordinalSortValue(ordinal);

  return numeric ? String(numeric) : normalizeForQuestionMatching(ordinal);
};

const inferTypeFromHeading = (title: string): DocumentOutlineNodeType => {
  const normalized = normalizeForQuestionMatching(title);

  if (/^(chuong|chapter)\b/.test(normalized)) {
    return "chapter";
  }

  if (/^(phan|part)\b/.test(normalized)) {
    return "part";
  }

  if (/^(muc|section)\b/.test(normalized)) {
    return "section";
  }

  if (/^(appendix|phu luc)\b/.test(normalized)) {
    return "appendix";
  }

  if (NUMBERED_HEADING_PATTERN.test(normalized)) {
    return normalized.split(".").length > 2 ? "subsection" : "section";
  }

  return "unknown";
};

const inferOrdinalFromHeading = (title: string): string | undefined => {
  const normalized = normalizeForQuestionMatching(title);
  const structureMatch = normalized.match(STRUCTURE_HEADING_PATTERN);

  if (structureMatch?.[2]) {
    return structureMatch[2];
  }

  const numberedMatch = normalized.match(NUMBERED_HEADING_PATTERN);

  if (numberedMatch?.[1]) {
    return numberedMatch[1];
  }

  return undefined;
};

const inferLevel = (title: string, fallbackLevel: number): number => {
  const type = inferTypeFromHeading(title);
  const ordinal = inferOrdinalFromHeading(title);

  if (type === "part") {
    return 1;
  }

  if (type === "chapter") {
    return 2;
  }

  if (type === "section") {
    return ordinal?.includes(".") ? Math.min(5, 2 + ordinal.split(".").length) : 3;
  }

  if (type === "subsection") {
    return ordinal?.includes(".") ? Math.min(6, 2 + ordinal.split(".").length) : 4;
  }

  return fallbackLevel;
};

const titleHasBodyName = (title: string): boolean => /[:.-]\s*\S+/.test(title);

const isLikelyTocOnlyTitle = (title: string): boolean => {
  const normalized = normalizeForQuestionMatching(title);

  return (
    /^(chuong|chapter|phan|part|muc|section)\s+([0-9]+|[ivxlcdm]+)$/.test(
      normalized,
    ) || /^[0-9]+(?:\.[0-9]+)*$/.test(normalized)
  );
};

const nodeQualityScore = (node: DocumentOutlineNode): number => {
  const bodyNameBonus = titleHasBodyName(node.title) ? 80 : 0;
  const sourceBonus =
    node.source === "semantic"
      ? 50
      : node.source === "layout"
        ? 40
        : node.source === "text"
          ? 20
          : 0;
  const confidenceBonus = node.confidence * 100;

  return node.title.length + bodyNameBonus + sourceBonus + confidenceBonus;
};

const unitKey = (node: DocumentOutlineNode): string => {
  const normalizedOrdinal = normalizeOrdinal(node.ordinal);
  const normalizedTitle = normalizeForQuestionMatching(node.title)
    .replace(/^(chuong|chapter|phan|part|muc|section)\s+([0-9]+|[ivxlcdm]+)\s*[:.-]?\s*/i, "")
    .trim();

  if (normalizedOrdinal && node.type !== "unknown") {
    return `${node.type}:${normalizedOrdinal}`;
  }

  return `${node.type}:${normalizedTitle || normalizeForQuestionMatching(node.title)}`;
};

const assignParents = (nodes: DocumentOutlineNode[]): DocumentOutlineNode[] => {
  const stack: DocumentOutlineNode[] = [];

  return nodes.map((node) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    const withParent = {
      ...node,
      parentId: parent ? parent.id : null,
    };

    stack.push(withParent);

    return withParent;
  });
};

const makeNode = ({
  title,
  level,
  index,
  source,
  confidence,
  textStart,
  textEnd,
}: {
  title: string;
  level: number;
  index: number;
  source: DocumentOutlineSource;
  confidence: number;
  textStart?: number;
  textEnd?: number;
}): DocumentOutlineNode => {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  const inferredLevel = inferLevel(cleanTitle, level);

  return {
    id: `outline-${index + 1}-${slugify(cleanTitle) || "section"}`,
    parentId: null,
    level: inferredLevel,
    type: inferTypeFromHeading(cleanTitle),
    title: cleanTitle,
    ordinal: inferOrdinalFromHeading(cleanTitle),
    textStart,
    textEnd,
    source,
    confidence,
  };
};

const dedupeOutlineNodes = (nodes: DocumentOutlineNode[]): DocumentOutlineNode[] => {
  const byKey = new Map<string, DocumentOutlineNode>();
  const orderedKeys: string[] = [];

  nodes.forEach((node) => {
    if (!node.title || node.title === GENERAL_CONTENT_TITLE) {
      return;
    }

    const key = unitKey(node);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, node);
      orderedKeys.push(key);
      return;
    }

    if (nodeQualityScore(node) > nodeQualityScore(existing)) {
      byKey.set(key, {
        ...node,
        id: existing.id,
      });
    }
  });

  const deduped = orderedKeys
    .map((key) => byKey.get(key))
    .filter((node): node is DocumentOutlineNode => Boolean(node));

  return assignParents(
    deduped.map((node, index) => ({
      ...node,
      id: `outline-${index + 1}-${slugify(node.title) || "section"}`,
    })),
  );
};

const extractTextRangeForTitle = (text: string, title: string): { start?: number; end?: number } => {
  const index = text.indexOf(title);

  if (index < 0) {
    return {};
  }

  return {
    start: index,
    end: index + title.length,
  };
};

const buildNodesFromChunks = (
  text: string,
  chunkingResult?: ChunkingResult,
): DocumentOutlineNode[] => {
  if (!chunkingResult || chunkingResult.chunkingStrategy !== "heading-based") {
    return [];
  }

  const sectionTitles = uniqueBy(
    chunkingResult.chunks
      .map((chunk) => chunk.metadata.sectionTitle || chunk.metadata.heading || "")
      .filter(Boolean),
    (title) => normalizeForQuestionMatching(title),
  );

  return sectionTitles.map((title, index) => {
    const range = extractTextRangeForTitle(text, title);

    return makeNode({
      title,
      level: inferLevel(title, 3),
      index,
      source: "chunk",
      confidence: isLikelyTocOnlyTitle(title) ? 0.45 : 0.68,
      textStart: range.start,
      textEnd: range.end,
    });
  });
};

const normalizeSemanticOutline = (
  nodes: DocumentOutlineNode[] | undefined,
): DocumentOutlineNode[] =>
  (nodes || [])
    .filter((node) => node.title?.trim())
    .map((node, index) => ({
      ...node,
      id: node.id || `outline-${index + 1}-${slugify(node.title) || "section"}`,
      level: node.level || inferLevel(node.title, 3),
      type:
        !node.type || node.type === "unknown"
          ? inferTypeFromHeading(node.title)
          : node.type,
      ordinal: node.ordinal || inferOrdinalFromHeading(node.title),
      source: node.source || "semantic",
      confidence: node.confidence ?? 0.92,
    }));

export const extractDocumentOutline = ({
  text,
  chunkingResult,
  semanticOutline,
}: ExtractDocumentOutlineInput): DocumentOutlineNode[] => {
  const semanticNodes = normalizeSemanticOutline(semanticOutline);
  const chunkNodes = buildNodesFromChunks(text, chunkingResult);

  return dedupeOutlineNodes([...semanticNodes, ...chunkNodes]);
};

export const getOutlineNodesByType = (
  outline: DocumentOutlineNode[] | undefined,
  type: DocumentOutlineNodeType,
): DocumentOutlineNode[] =>
  (outline || []).filter(
    (node) =>
      node.type === type &&
      node.confidence >= 0.55 &&
      !(node.source === "chunk" && isLikelyTocOnlyTitle(node.title)),
  );

export const summarizeDocumentOutline = (
  outline: DocumentOutlineNode[] | undefined,
) => {
  const nodes = outline || [];
  const chapterNodes = getOutlineNodesByType(nodes, "chapter");
  const partNodes = getOutlineNodesByType(nodes, "part");
  const explicitSectionNodes = [
    ...getOutlineNodesByType(nodes, "section"),
    ...getOutlineNodesByType(nodes, "subsection"),
  ];
  const sectionNodes =
    explicitSectionNodes.length > 0
      ? explicitSectionNodes
      : nodes.filter((node) => node.confidence >= 0.55);

  return {
    detectedSections: nodes.map((node) => node.title),
    chapterSections: chapterNodes.map((node) => node.title),
    partSections: partNodes.map((node) => node.title),
    sectionSections: sectionNodes.map((node) => node.title),
    chapterCount: chapterNodes.length,
    partCount: partNodes.length,
    sectionCount: sectionNodes.length,
  };
};

const getBestOutlineNodeForHeading = (
  outline: DocumentOutlineNode[] | undefined,
  heading: string,
): DocumentOutlineNode | undefined => {
  if (!heading || !outline?.length) {
    return undefined;
  }

  const normalizedHeading = normalizeForQuestionMatching(heading);
  const headingOrdinal = normalizeOrdinal(inferOrdinalFromHeading(heading));
  const headingType = inferTypeFromHeading(heading);

  return outline.find((node) => {
    if (normalizeForQuestionMatching(node.title) === normalizedHeading) {
      return true;
    }

    return (
      node.type === headingType &&
      normalizeOrdinal(node.ordinal) === headingOrdinal &&
      Boolean(headingOrdinal)
    );
  });
};

const buildOutlinePath = (
  outline: DocumentOutlineNode[] | undefined,
  node: DocumentOutlineNode | undefined,
): string | undefined => {
  if (!outline?.length || !node) {
    return undefined;
  }

  const byId = new Map(outline.map((outlineNode) => [outlineNode.id, outlineNode]));
  const path: string[] = [];
  let current: DocumentOutlineNode | undefined = node;

  while (current) {
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path.join(" > ");
};

const findAncestorByType = (
  outline: DocumentOutlineNode[] | undefined,
  node: DocumentOutlineNode | undefined,
  type: DocumentOutlineNodeType,
): DocumentOutlineNode | undefined => {
  if (!outline?.length || !node) {
    return undefined;
  }

  const byId = new Map(outline.map((outlineNode) => [outlineNode.id, outlineNode]));
  let current: DocumentOutlineNode | undefined = node;

  while (current) {
    if (current.type === type) {
      return current;
    }

    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return undefined;
};

export const applyOutlineToChunks = (
  chunks: DocumentChunk[],
  outline: DocumentOutlineNode[] | undefined,
): DocumentChunk[] =>
  chunks.map((chunk) => {
    const heading = chunk.metadata.sectionTitle || chunk.metadata.heading || "";
    const outlineNode = getBestOutlineNodeForHeading(outline, heading);
    const chapterAncestor = findAncestorByType(outline, outlineNode, "chapter");

    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        outlineNodeId: outlineNode?.id,
        outlinePath: buildOutlinePath(outline, outlineNode),
        outlineLevel: outlineNode?.level,
        outlineType: outlineNode?.type,
        chapterOrdinal: chapterAncestor?.ordinal,
      },
    };
  });
