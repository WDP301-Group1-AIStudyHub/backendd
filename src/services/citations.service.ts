import { ChatSource } from "../types/api.types";

interface ApplyCitationsInput {
  answer: string;
  /** Retrieved sources carrying their original (pre-renumbering) citationId. */
  sources: ChatSource[];
}

interface ApplyCitationsOutput {
  answer: string;
  citedSources: ChatSource[];
}

/**
 * Splits text into code segments (fenced or inline code) and normal markdown text segments,
 * so citation markers inside code blocks or inline code are preserved untouched.
 */
function splitCodeBlocks(text: string): { text: string; isCode: boolean }[] {
  const segments: { text: string; isCode: boolean }[] = [];
  // Match fenced code blocks (```...```) or inline code (`...`)
  const codeRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isCode: false,
      });
    }
    segments.push({
      text: match[0],
      isCode: true,
    });
    lastIndex = codeRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isCode: false,
    });
  }

  return segments;
}

export function applyCitations({
  answer,
  sources,
}: ApplyCitationsInput): ApplyCitationsOutput {
  if (!answer || !sources || sources.length === 0) {
    return { answer: answer ?? "", citedSources: [] };
  }

  // Create a set of valid original citation IDs from available sources
  const validOriginalIds = new Set<number>();
  const sourceByCitationId = new Map<number, ChatSource>();

  for (const source of sources) {
    if (source.citationId !== undefined && source.citationId > 0) {
      validOriginalIds.add(source.citationId);
      if (!sourceByCitationId.has(source.citationId)) {
        sourceByCitationId.set(source.citationId, source);
      }
    }
  }

  if (validOriginalIds.size === 0) {
    return { answer, citedSources: [] };
  }

  const segments = splitCodeBlocks(answer);

  // Regex to match citation markers like [1], [12], but NOT markdown links like [1](http...)
  const markerRegex = /\[(\d+)\](?!\()/g;
  // Same, but also capturing any whitespace immediately before the marker, so
  // dropping a hallucinated marker does not leave a doubled space behind.
  const markerWithLeadingSpaceRegex = /([ \t]*)\[(\d+)\](?!\()/g;

  // Pass 1: Find all valid citation IDs in first-appearance order
  const firstAppearanceOrder: number[] = [];
  const seenOriginalIds = new Set<number>();

  for (const segment of segments) {
    if (segment.isCode) continue;

    let match: RegExpExecArray | null;
    markerRegex.lastIndex = 0;
    while ((match = markerRegex.exec(segment.text)) !== null) {
      const originalId = parseInt(match[1], 10);
      if (validOriginalIds.has(originalId)) {
        if (!seenOriginalIds.has(originalId)) {
          seenOriginalIds.add(originalId);
          firstAppearanceOrder.push(originalId);
        }
      }
    }
  }

  // Construct dense renumbering map: originalId -> newId (1, 2, 3...)
  const renumberMap = new Map<number, number>();
  firstAppearanceOrder.forEach((originalId, index) => {
    renumberMap.set(originalId, index + 1);
  });

  // Pass 2: Rewrite markers in non-code segments
  const processedSegments = segments.map((segment) => {
    if (segment.isCode) return segment.text;

    return segment.text.replace(
      markerWithLeadingSpaceRegex,
      (fullMatch, whitespace: string, idStr: string) => {
        const originalId = parseInt(idStr, 10);

        if (validOriginalIds.has(originalId)) {
          return `${whitespace}[${renumberMap.get(originalId)}]`;
        }

        // Citation ids start at 1, so `[0]` was never a citation — leave it as
        // the literal text the author wrote.
        if (originalId <= 0) return fullMatch;

        // Drop hallucinated markers along with the space that preceded them.
        return "";
      },
    );
  });

  const finalAnswer = processedSegments.join("");

  // Build citedSources array mapped to new citation IDs in order (1, 2, 3...)
  const citedSources: ChatSource[] = firstAppearanceOrder.map(
    (originalId, idx) => {
      const originalSource = sourceByCitationId.get(originalId)!;
      return {
        ...originalSource,
        citationId: idx + 1,
      };
    },
  );

  return {
    answer: finalAnswer,
    citedSources,
  };
}
