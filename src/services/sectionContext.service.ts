import type { SectionReference } from "../utils/answerProfile";
import {
  extractSectionReference,
  normalizeForQuestionMatching,
} from "../utils/answerProfile";
import type { RetrievedChunk } from "./vector.service";
import { fetchVectorChunksByIds } from "./vector.service";

export type SectionContextSelection = {
  chunks: RetrievedChunk[];
  usedSectionExpansion: boolean;
  selectedSectionTitle?: string;
};

type VectorIdParts = {
  prefix: string;
  chunkIndex: number;
};

const DEFAULT_NEIGHBOR_WINDOW = 18;
const DEFAULT_MAX_SECTION_CHUNKS = 16;

const parseChunkVectorId = (id: string): VectorIdParts | undefined => {
  const separatorIndex = id.lastIndexOf(":");

  if (separatorIndex < 0) {
    return undefined;
  }

  const chunkIndex = Number(id.slice(separatorIndex + 1));

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return undefined;
  }

  return {
    prefix: id.slice(0, separatorIndex),
    chunkIndex,
  };
};

export const buildNeighborVectorIds = (
  id: string,
  window = DEFAULT_NEIGHBOR_WINDOW,
): string[] => {
  const parsed = parseChunkVectorId(id);

  if (!parsed) {
    return [];
  }

  const ids: string[] = [];
  const start = Math.max(0, parsed.chunkIndex - window);
  const end = parsed.chunkIndex + window;

  for (let chunkIndex = start; chunkIndex <= end; chunkIndex += 1) {
    ids.push(`${parsed.prefix}:${chunkIndex}`);
  }

  return ids;
};

const normalizeSectionNumber = (value: string): number | undefined => {
  const normalized = normalizeForQuestionMatching(value);
  const numericMatch = normalized.match(/\b([0-9]+)\b/);

  if (numericMatch) {
    const numeric = Number(numericMatch[1]);
    return Number.isInteger(numeric) ? numeric : undefined;
  }

  const romanMatch = normalized.match(/\b([ivxlcdm]+)\b/);

  if (!romanMatch) {
    return undefined;
  }

  return extractSectionReference(`chuong ${romanMatch[1]}`)?.numericValue;
};

export const chunkMatchesSectionReference = (
  chunk: RetrievedChunk,
  reference: SectionReference,
): boolean => {
  const headingText = [
    chunk.metadata.heading,
    chunk.metadata.sectionTitle,
    chunk.metadata.inferredSection,
    chunk.metadata.semanticSectionLabel,
    chunk.metadata.outlinePath,
    chunk.metadata.outlineType,
    chunk.metadata.chapterOrdinal
      ? `chuong ${chunk.metadata.chapterOrdinal} chapter ${chunk.metadata.chapterOrdinal}`
      : undefined,
    chunk.content.slice(0, 180),
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedHeading = normalizeForQuestionMatching(headingText);

  if (!normalizedHeading.includes(reference.keyword)) {
    return false;
  }

  if (!reference.numericValue) {
    return normalizedHeading.includes(reference.rawValue);
  }

  return normalizeSectionNumber(normalizedHeading) === reference.numericValue;
};

export const findSectionSeedChunk = (
  chunks: RetrievedChunk[],
  reference: SectionReference,
): RetrievedChunk | undefined => {
  const matchingChunks = chunks.filter((chunk) =>
    chunkMatchesSectionReference(chunk, reference),
  );

  return matchingChunks.sort(
    (a, b) => (b.pineconeScore ?? 0) - (a.pineconeScore ?? 0),
  )[0];
};

const dedupeChunksById = (chunks: RetrievedChunk[]): RetrievedChunk[] => {
  const byId = new Map<string, RetrievedChunk>();

  chunks.forEach((chunk) => {
    const existing = byId.get(chunk.id);

    if (!existing || (chunk.pineconeScore ?? 0) > (existing.pineconeScore ?? 0)) {
      byId.set(chunk.id, chunk);
    }
  });

  return [...byId.values()];
};

export const selectExpandedSectionChunks = (
  seedChunk: RetrievedChunk,
  chunks: RetrievedChunk[],
  maxChunks = DEFAULT_MAX_SECTION_CHUNKS,
): RetrievedChunk[] => {
  const seedSectionIndex = seedChunk.metadata.sectionIndex;
  const seedOutlineNodeId = seedChunk.metadata.outlineNodeId;
  const seedChapterOrdinal = seedChunk.metadata.chapterOrdinal;
  const sameSectionChunks =
    seedOutlineNodeId
      ? chunks.filter(
          (chunk) =>
            chunk.metadata.documentId === seedChunk.metadata.documentId &&
            chunk.metadata.outlineNodeId === seedOutlineNodeId,
        )
      : seedChapterOrdinal
        ? chunks.filter(
            (chunk) =>
              chunk.metadata.documentId === seedChunk.metadata.documentId &&
              chunk.metadata.chapterOrdinal === seedChapterOrdinal,
          )
        : seedSectionIndex === undefined
          ? []
          : chunks.filter(
              (chunk) =>
                chunk.metadata.documentId === seedChunk.metadata.documentId &&
                chunk.metadata.sectionIndex === seedSectionIndex,
            );
  const selected =
    sameSectionChunks.length > 0
      ? sameSectionChunks
      : chunks.filter(
          (chunk) =>
            chunk.metadata.documentId === seedChunk.metadata.documentId &&
            Math.abs(
              chunk.metadata.chunkIndex - seedChunk.metadata.chunkIndex,
            ) <= 6,
        );

  return dedupeChunksById(selected)
    .sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex)
    .slice(0, maxChunks);
};

export const selectContextChunksForQuestion = async (
  question: string,
  chunks: RetrievedChunk[],
  options: {
    maxChunks?: number;
    neighborWindow?: number;
  } = {},
): Promise<SectionContextSelection> => {
  const reference = extractSectionReference(question);

  if (!reference) {
    return {
      chunks: chunks.slice(0, options.maxChunks ?? DEFAULT_MAX_SECTION_CHUNKS),
      usedSectionExpansion: false,
    };
  }

  const seedChunk = findSectionSeedChunk(chunks, reference);

  if (!seedChunk) {
    return {
      chunks: chunks.slice(0, options.maxChunks ?? DEFAULT_MAX_SECTION_CHUNKS),
      usedSectionExpansion: false,
    };
  }

  const neighborIds = buildNeighborVectorIds(
    seedChunk.id,
    options.neighborWindow ?? DEFAULT_NEIGHBOR_WINDOW,
  );
  const fetchedChunks = await fetchVectorChunksByIds(neighborIds);
  const expandedChunks = selectExpandedSectionChunks(
    seedChunk,
    dedupeChunksById([...chunks, ...fetchedChunks]),
    options.maxChunks,
  );

  return {
    chunks: expandedChunks.length > 0 ? expandedChunks : chunks,
    usedSectionExpansion: expandedChunks.length > 0,
    selectedSectionTitle:
      seedChunk.metadata.outlinePath ||
      seedChunk.metadata.sectionTitle ||
      seedChunk.metadata.heading ||
      seedChunk.metadata.inferredSection,
  };
};
