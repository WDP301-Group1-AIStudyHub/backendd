import type { DocumentChunk, ChunkingResult, ChunkingStrategy } from "./textSplitter";
import { normalizeForQuestionMatching } from "./answerProfile";

export type DocumentStructureUnit = "chapter" | "part" | "section";

export type StructuralQuestion = {
  unit: DocumentStructureUnit;
};

export type DocumentStructureSummary = {
  chunkingStrategy: ChunkingStrategy;
  detectedSections: string[];
  chapterSections: string[];
  partSections: string[];
  sectionSections: string[];
  chapterCount: number;
  partCount: number;
  sectionCount: number;
};

const COUNT_PATTERN =
  /\b(may|bao nhieu|co bao nhieu|how many|number of|count)\b/i;
const STRUCTURE_UNIT_PATTERN =
  /\b(chuong|chapter|chapters|phan|part|parts|muc|section|sections)\b/i;
const SPECIFIC_SECTION_REFERENCE_PATTERN =
  /\b(chuong|chapter|phan|part|muc|section)\s*(?:so\s*)?([0-9]+|[ivxlcdm]+)\b/i;

const CHAPTER_HEADING_PATTERN =
  /\b(chuong|chapter)\s*([0-9]+|[ivxlcdm]+)\b/i;
const PART_HEADING_PATTERN = /\b(phan|part)\s*([0-9]+|[ivxlcdm]+)\b/i;
const SECTION_HEADING_PATTERN =
  /\b(muc|section)\s*([0-9]+|[ivxlcdm]+)\b/i;
const GENERAL_CONTENT_TITLE = "General Content";
const ROMAN_VALUES: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

const uniqueStrings = (values: string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

export const detectStructuralQuestion = (
  question: string,
): StructuralQuestion | null => {
  const normalizedQuestion = normalizeForQuestionMatching(question);

  if (!COUNT_PATTERN.test(normalizedQuestion)) {
    return null;
  }

  if (SPECIFIC_SECTION_REFERENCE_PATTERN.test(normalizedQuestion)) {
    return null;
  }

  const unitMatch = normalizedQuestion.match(STRUCTURE_UNIT_PATTERN);

  if (!unitMatch) {
    return null;
  }

  const unit = unitMatch[1];

  if (unit === "chuong" || unit === "chapter" || unit === "chapters") {
    return { unit: "chapter" };
  }

  if (unit === "phan" || unit === "part" || unit === "parts") {
    return { unit: "part" };
  }

  return { unit: "section" };
};

const getSectionTitle = (chunk: DocumentChunk): string =>
  chunk.metadata.sectionTitle || chunk.metadata.heading || "";

const filterSectionsByPattern = (
  sections: string[],
  pattern: RegExp,
): string[] =>
  sections.filter((section) => pattern.test(normalizeForQuestionMatching(section)));

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

const parseStructureNumber = (value: string): number | undefined => {
  const numeric = Number(value);

  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  return romanToNumber(value);
};

const getStructureEntryKey = (
  section: string,
  unit: DocumentStructureUnit,
): string => {
  const normalizedSection = normalizeForQuestionMatching(section);
  const pattern =
    unit === "chapter"
      ? CHAPTER_HEADING_PATTERN
      : unit === "part"
        ? PART_HEADING_PATTERN
        : SECTION_HEADING_PATTERN;
  const match = normalizedSection.match(pattern);
  const structureNumber = match?.[2]
    ? parseStructureNumber(match[2])
    : undefined;

  if (structureNumber) {
    return `${unit}:${structureNumber}`;
  }

  return `${unit}:${normalizedSection}`;
};

const headingQualityScore = (section: string): number => {
  const normalizedSection = normalizeForQuestionMatching(section);
  const wordCount = normalizedSection.split(/\s+/).filter(Boolean).length;
  const hasTitleSeparator = /[:.-]/.test(section);

  return section.trim().length + wordCount * 5 + (hasTitleSeparator ? 40 : 0);
};

const dedupeStructureSections = (
  sections: string[],
  unit: DocumentStructureUnit,
): string[] => {
  const byKey = new Map<string, string>();

  sections.forEach((section) => {
    const key = getStructureEntryKey(section, unit);
    const existing = byKey.get(key);

    if (!existing || headingQualityScore(section) > headingQualityScore(existing)) {
      byKey.set(key, section);
    }
  });

  return [...byKey.values()];
};

export const analyzeDocumentStructure = (
  chunkingResult: ChunkingResult,
): DocumentStructureSummary => {
  const detectedSections = uniqueStrings(
    chunkingResult.chunks.map((chunk) => getSectionTitle(chunk)),
  );
  const hasDetectedDocumentStructure =
    chunkingResult.chunkingStrategy === "heading-based" &&
    !(
      detectedSections.length === 1 &&
      detectedSections[0] === GENERAL_CONTENT_TITLE
    );
  const chapterSections = filterSectionsByPattern(
    detectedSections,
    CHAPTER_HEADING_PATTERN,
  );
  const partSections = filterSectionsByPattern(
    detectedSections,
    PART_HEADING_PATTERN,
  );
  const explicitSectionSections = filterSectionsByPattern(
    detectedSections,
    SECTION_HEADING_PATTERN,
  );
  const sectionSections =
    explicitSectionSections.length > 0
      ? explicitSectionSections
      : hasDetectedDocumentStructure
        ? detectedSections
        : [];
  const dedupedChapterSections = dedupeStructureSections(
    chapterSections,
    "chapter",
  );
  const dedupedPartSections = dedupeStructureSections(partSections, "part");
  const dedupedSectionSections = dedupeStructureSections(
    sectionSections,
    "section",
  );

  return {
    chunkingStrategy: chunkingResult.chunkingStrategy,
    detectedSections,
    chapterSections: dedupedChapterSections,
    partSections: dedupedPartSections,
    sectionSections: dedupedSectionSections,
    chapterCount: dedupedChapterSections.length,
    partCount: dedupedPartSections.length,
    sectionCount: dedupedSectionSections.length,
  };
};

export const getSectionsForUnit = (
  summary: DocumentStructureSummary,
  unit: DocumentStructureUnit,
): string[] => {
  if (unit === "chapter") {
    return summary.chapterSections;
  }

  if (unit === "part") {
    return summary.partSections;
  }

  return summary.sectionSections;
};

export const getCountForUnit = (
  summary: DocumentStructureSummary,
  unit: DocumentStructureUnit,
): number => getSectionsForUnit(summary, unit).length;

export const getVietnameseStructureUnitLabel = (
  unit: DocumentStructureUnit,
): string => {
  if (unit === "chapter") {
    return "chương";
  }

  if (unit === "part") {
    return "phần";
  }

  return "section";
};

export const getStructureNotFoundAnswer = (
  unit: DocumentStructureUnit,
): string => {
  const label = getVietnameseStructureUnitLabel(unit);

  return `Không tìm thấy thông tin về số ${label} trong tài liệu này. Có thể tài liệu chưa chứa thông tin này hoặc câu hỏi quá chung chung. Bạn có thể thử hỏi cụ thể hơn về nội dung của tài liệu hoặc kiểm tra lại tài liệu để đảm bảo thông tin cần thiết đã được cập nhật.`;
};

export const formatStructureCountAnswer = (
  unit: DocumentStructureUnit,
  sections: string[],
): string => {
  const label = getVietnameseStructureUnitLabel(unit);
  const count = sections.length;
  const sectionList = sections.map((section) => `- ${section}`).join("\n");

  return `Tài liệu này có ${count} ${label}:\n${sectionList}`;
};
