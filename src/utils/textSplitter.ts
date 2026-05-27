import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { SectionLabel, detectSectionFromHeading } from "./documentSection";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  metadata: {
    textLength: number;
    section?: SectionLabel;
    inferredSection?: string;
    semanticSectionLabel?: string;
  };
}

type SectionBlock = {
  inferredSection?: SectionLabel;
  content: string;
};

const splitTextIntoSectionBlocks = (text: string): SectionBlock[] => {
  const blocks: SectionBlock[] = [];
  const currentLines: string[] = [];
  let currentSection: SectionLabel | undefined;

  const flushCurrentBlock = (): void => {
    const content = currentLines.join("\n").trim();

    if (content) {
      blocks.push({
        inferredSection: currentSection,
        content,
      });
    }

    currentLines.length = 0;
  };

  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previousLine = lines[index - 1] ?? "";
    const nextLine = lines[index + 1] ?? "";
    const detectedSection = detectSectionFromHeading(
      line,
      previousLine,
      nextLine,
    );

    if (detectedSection) {
      flushCurrentBlock();
      console.log("[RAG section transition]", {
        from: currentSection,
        to: detectedSection,
        heading: line.trim(),
      });
      currentSection = detectedSection;
      currentLines.push(line);
      continue;
    }

    currentLines.push(line);
  }

  flushCurrentBlock();

  return blocks.length > 0
    ? blocks
    : [
        {
          content: text,
        },
      ];
};

export const splitTextIntoChunks = async (
  text: string,
): Promise<DocumentChunk[]> => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks: DocumentChunk[] = [];
  const sectionBlocks = splitTextIntoSectionBlocks(text);

  for (const block of sectionBlocks) {
    const blockChunks = await splitter.splitText(block.content);

    blockChunks.forEach((content) => {
      const trimmedContent = content.trim();

      if (!trimmedContent) {
        return;
      }

      chunks.push({
        chunkIndex: chunks.length,
        content: trimmedContent,
        metadata: {
          textLength: trimmedContent.length,
          section: block.inferredSection,
          inferredSection: block.inferredSection,
          semanticSectionLabel: block.inferredSection,
        },
      });
      console.log("[RAG chunk section]", {
        chunkIndex: chunks.length - 1,
        inferredSection: block.inferredSection,
        textLength: trimmedContent.length,
      });
    });
  }

  return chunks;
};
