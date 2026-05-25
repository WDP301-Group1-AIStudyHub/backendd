import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { DocumentSection, detectSectionFromHeading } from "./documentSection";
import { detectSection } from "./sectionDetector";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  metadata: {
    textLength: number;
    section: DocumentSection;
  };
}

type SectionBlock = {
  section: DocumentSection;
  content: string;
};

const HEADING_FRAGMENTS = new Set([
  "WORK",
  "PROFESSIONAL",
  "EMPLOYMENT",
  "HISTORY",
  "EXPERIENCE",
  "EDUCATION",
  "ACADEMIC",
  "BACKGROUND",
  "SKILLS",
  "TECHNICAL",
  "PROJECT",
  "PROJECTS",
  "CERTIFICATIONS",
  "CERTIFICATES",
  "INSTRUCTIONS",
  "GUIDELINES",
  "OBJECTIVE",
  "CAREER",
  "QUESTIONS",
  "EXERCISES",
  "SUMMARY",
  "ABSTRACT",
  "HỌC",
  "VẤN",
  "KỸ",
  "NĂNG",
  "DỰ",
  "ÁN",
  "CHỨNG",
  "CHỈ",
  "HƯỚNG",
  "DẪN",
]);

const isHeadingFragment = (line: string): boolean => {
  const normalizedLine = line
    .toUpperCase()
    .replace(/^[\s:;.,|/\\-]+|[\s:;.,|/\\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return HEADING_FRAGMENTS.has(normalizedLine);
};

const splitTextIntoSectionBlocks = (text: string): SectionBlock[] => {
  const blocks: SectionBlock[] = [];
  const currentLines: string[] = [];
  let currentSection: DocumentSection = "UNKNOWN";

  const flushCurrentBlock = (): void => {
    const content = currentLines.join("\n").trim();

    if (content) {
      blocks.push({
        section: currentSection,
        content,
      });
    }

    currentLines.length = 0;
  };

  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] ?? "";
    const thirdLine = lines[index + 2] ?? "";
    const headingCandidates = [
      { text: line, consumedLines: 1, canCheck: true },
      {
        text: `${line} ${nextLine}`,
        consumedLines: 2,
        canCheck: isHeadingFragment(line) && isHeadingFragment(nextLine),
      },
      {
        text: `${line} ${nextLine} ${thirdLine}`,
        consumedLines: 3,
        canCheck:
          isHeadingFragment(line) &&
          isHeadingFragment(nextLine) &&
          isHeadingFragment(thirdLine),
      },
    ];
    const detectedHeading = headingCandidates.find((candidate) => {
      if (!candidate.canCheck) {
        return false;
      }

      const compactCandidate = candidate.text.replace(/\s+/g, " ").trim();

      return (
        compactCandidate.length > 0 &&
        compactCandidate.length <= 120 &&
        detectSection(compactCandidate) !== "UNKNOWN"
      );
    });
    const detectedSection = detectedHeading
      ? detectSection(detectedHeading.text)
      : detectSectionFromHeading(line);

    if (detectedSection) {
      flushCurrentBlock();
      console.log("[RAG section transition]", {
        from: currentSection,
        to: detectedSection,
        heading: detectedHeading?.text.replace(/\s+/g, " ").trim() || line.trim(),
      });
      currentSection = detectedSection;
      currentLines.push(
        ...lines.slice(index, index + (detectedHeading?.consumedLines ?? 1)),
      );
      index += (detectedHeading?.consumedLines ?? 1) - 1;
      continue;
    }

    currentLines.push(line);
  }

  flushCurrentBlock();

  return blocks.length > 0
    ? blocks
    : [
        {
          section: "UNKNOWN",
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
          section: block.section,
        },
      });
      console.log("[RAG chunk section]", {
        chunkIndex: chunks.length - 1,
        section: block.section,
        textLength: trimmedContent.length,
      });
    });
  }

  return chunks;
};
