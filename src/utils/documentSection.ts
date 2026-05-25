import { DocumentSection, normalizeSectionText } from "./sectionDetector";

export type { DocumentSection };

const NUMBERED_HEADING_REGEX =
  /^((\d+(\.\d+)*\.?)|((CHAPTER|SECTION)\s+\d+(\.\d+)*))(\s+.+)?$/i;
const ENDING_PUNCTUATION_REGEX = /[.!?。！？]$/;

const getUppercaseRatio = (text: string): number => {
  const letters = text.match(/\p{L}/gu) ?? [];

  if (letters.length === 0) {
    return 0;
  }

  const uppercaseLetters = letters.filter(
    (letter) => letter === letter.toUpperCase() && letter !== letter.toLowerCase(),
  );

  return uppercaseLetters.length / letters.length;
};

const isBlank = (line: string | undefined): boolean => !line?.trim();

export const isLikelyHeading = (
  line: string,
  previousLine?: string,
  nextLine?: string,
): boolean => {
  const trimmedLine = line.trim();
  const normalizedText = normalizeSectionText(line);

  if (!normalizedText || normalizedText.length > 120) {
    return false;
  }

  if (ENDING_PUNCTUATION_REGEX.test(trimmedLine)) {
    return false;
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const uppercaseRatio = getUppercaseRatio(line);
  const isNumberedHeading = NUMBERED_HEADING_REGEX.test(normalizedText);
  const appearsIsolated = isBlank(previousLine) || isBlank(nextLine);
  const followedByContent = Boolean(nextLine?.trim());
  const formatLooksLikeHeading =
    isNumberedHeading ||
    uppercaseRatio >= 0.65 ||
    (wordCount <= 8 && normalizedText.length <= 80 && appearsIsolated);

  return formatLooksLikeHeading && followedByContent;
};

export const detectSectionFromHeading = (
  text: string,
  previousLine?: string,
  nextLine?: string,
): DocumentSection | null => {
  return isLikelyHeading(text, previousLine, nextLine) ? "CONTENT" : null;
};
