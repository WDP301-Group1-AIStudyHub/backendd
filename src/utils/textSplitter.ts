import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {
  detectSectionFromHeading,
  isDocumentNoiseLine,
  normalizeHeadingCandidate,
} from "./documentSection";
import { repairUtf8Mojibake } from "./textEncoding";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const GENERAL_SECTION_TITLE = "General Content";

export type ChunkingStrategy = "heading-based" | "fixed-size-fallback";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  metadata: {
    heading: string | null;
    sectionTitle: string;
    sectionIndex: number;
    contentLength: number;
    textLength: number;
    chunkingStrategy: ChunkingStrategy;
    section?: string;
    inferredSection?: string;
    semanticSectionLabel?: string;
    outlineNodeId?: string;
    outlinePath?: string;
    outlineLevel?: number;
    outlineType?: string;
    chapterOrdinal?: string;
  };
}

export interface ChunkingResult {
  chunkingStrategy: ChunkingStrategy;
  chunks: DocumentChunk[];
}

type HeadingSection = {
  heading: string | null;
  sectionTitle: string;
  sectionIndex: number;
  body: string;
};

const removeDocumentNoiseLines = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((line) => !isDocumentNoiseLine(line))
    .join("\n");

const createBodySplitter = (headingLength = 0): RecursiveCharacterTextSplitter =>
  new RecursiveCharacterTextSplitter({
    chunkSize: Math.max(300, CHUNK_SIZE - headingLength - 1),
    chunkOverlap: CHUNK_OVERLAP,
  });

const splitTextIntoHeadingSections = (text: string): HeadingSection[] => {
  const lines = text.split(/\r?\n/);
  const sections: HeadingSection[] = [];
  let currentHeading: string | null = null;
  let currentBodyLines: string[] = [];
  let headingsDetected = false;

  const flushSection = (): void => {
    const body = currentBodyLines.join("\n").trim();

    if (body || currentHeading) {
      sections.push({
        heading: currentHeading,
        sectionTitle: currentHeading || GENERAL_SECTION_TITLE,
        sectionIndex: sections.length,
        body,
      });
    }

    currentBodyLines = [];
  };

  const findNextContentLine = (startIndex: number): string | undefined => {
    for (let index = startIndex; index < lines.length; index += 1) {
      if (lines[index].trim() && !isDocumentNoiseLine(lines[index])) {
        return lines[index];
      }
    }

    return undefined;
  };

  lines.forEach((line, index) => {
    if (isDocumentNoiseLine(line)) {
      return;
    }

    const detectedHeading = detectSectionFromHeading(
      line,
      lines[index - 1],
      lines[index + 1],
      findNextContentLine(index + 1),
    );

    if (detectedHeading) {
      flushSection();
      headingsDetected = true;
      currentHeading = normalizeHeadingCandidate(detectedHeading);
      return;
    }

    currentBodyLines.push(line);
  });

  flushSection();

  return headingsDetected
    ? sections.filter((section) => section.body || section.heading)
    : [];
};

const buildChunkContent = (heading: string | null, body: string): string => {
  const trimmedBody = body.trim();

  if (!heading) {
    return trimmedBody;
  }

  return trimmedBody ? `${heading}\n${trimmedBody}` : heading;
};

const chunkHeadingSections = async (
  sections: HeadingSection[],
): Promise<DocumentChunk[]> => {
  const chunks: DocumentChunk[] = [];

  for (const section of sections) {
    const sectionContent = buildChunkContent(section.heading, section.body);
    const sectionContentLength = sectionContent.length;

    if (sectionContentLength <= CHUNK_SIZE) {
      chunks.push({
        chunkIndex: chunks.length,
        content: sectionContent,
        metadata: {
          heading: section.heading,
          sectionTitle: section.sectionTitle,
          sectionIndex: section.sectionIndex,
          contentLength: sectionContentLength,
          textLength: sectionContentLength,
          chunkingStrategy: "heading-based",
          section: section.sectionTitle,
          inferredSection: section.sectionTitle,
          semanticSectionLabel: section.sectionTitle,
        },
      });
      continue;
    }

    const splitter = createBodySplitter(section.heading?.length ?? 0);
    const bodyChunks = await splitter.splitText(section.body);

    bodyChunks.forEach((bodyChunk) => {
      const content = buildChunkContent(section.heading, bodyChunk);

      if (!content.trim()) {
        return;
      }

      chunks.push({
        chunkIndex: chunks.length,
        content,
        metadata: {
          heading: section.heading,
          sectionTitle: section.sectionTitle,
          sectionIndex: section.sectionIndex,
          contentLength: content.length,
          textLength: content.length,
          chunkingStrategy: "heading-based",
          section: section.sectionTitle,
          inferredSection: section.sectionTitle,
          semanticSectionLabel: section.sectionTitle,
        },
      });
    });
  }

  return chunks;
};

const chunkByFixedSizeFallback = async (text: string): Promise<DocumentChunk[]> => {
  const splitter = createBodySplitter();
  const textChunks = await splitter.splitText(text);

  return textChunks
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content, chunkIndex) => ({
      chunkIndex,
      content,
      metadata: {
        heading: null,
        sectionTitle: GENERAL_SECTION_TITLE,
        sectionIndex: 0,
        contentLength: content.length,
        textLength: content.length,
        chunkingStrategy: "fixed-size-fallback" as const,
        section: GENERAL_SECTION_TITLE,
        inferredSection: GENERAL_SECTION_TITLE,
        semanticSectionLabel: GENERAL_SECTION_TITLE,
      },
    }));
};

export const splitTextForRag = async (text: string): Promise<ChunkingResult> => {
  const encodingRepair = repairUtf8Mojibake(text);
  const chunkableText = removeDocumentNoiseLines(encodingRepair.text);
  const sections = splitTextIntoHeadingSections(chunkableText);

  if (sections.length === 0) {
    const chunks = await chunkByFixedSizeFallback(chunkableText);

    console.log("[RAG chunking] Used fixed-size fallback", {
      chunksCount: chunks.length,
    });

    return {
      chunkingStrategy: "fixed-size-fallback",
      chunks,
    };
  }

  const chunks = await chunkHeadingSections(sections);

  console.log("[RAG chunking] Used heading-based chunks", {
    sectionsCount: sections.length,
    chunksCount: chunks.length,
  });

  return {
    chunkingStrategy: "heading-based",
    chunks,
  };
};

export const splitTextIntoChunks = async (
  text: string,
): Promise<DocumentChunk[]> => {
  const result = await splitTextForRag(text);

  return result.chunks;
};
