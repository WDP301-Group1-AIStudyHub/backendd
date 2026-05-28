export type SectionLabel = string;

const NUMBERED_HEADING_REGEX =
  /^((\d+(\.\d+)*\.?)|((CHAPTER|SECTION)\s+\d+(\.\d+)*))(\s+.+)?$/i;
const ENDING_PUNCTUATION_REGEX = /[.!?。！？]$/;

export const normalizeHeadingCandidate = (text: string): string =>
  text
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;.,|/\\-]+|[\s:;.,|/\\-]+$/g, "")
    .trim();

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
  nextContentLine?: string,
): boolean => {
  const trimmedLine = line.trim();
  const normalizedText = normalizeHeadingCandidate(line);

  if (!normalizedText || normalizedText.length > 120) {
    return false;
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const uppercaseRatio = getUppercaseRatio(line);
  const isNumberedHeading = NUMBERED_HEADING_REGEX.test(normalizedText);
  const appearsIsolated = isBlank(previousLine) || isBlank(nextLine);
  const followedByContent = Boolean((nextContentLine ?? nextLine)?.trim());
  const hasEndingPunctuation = ENDING_PUNCTUATION_REGEX.test(trimmedLine);

  if (hasEndingPunctuation && !isNumberedHeading) {
    return false;
  }

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
  nextContentLine?: string,
): SectionLabel | null => {
  if (!isLikelyHeading(text, previousLine, nextLine, nextContentLine)) {
    return null;
  }

  // Dynamic section labels preserve arbitrary document structure instead of
  // forcing uploaded files into predefined section enums. Retrieval remains
  // embedding-first, so section text is only contextual metadata.
  return normalizeHeadingCandidate(text);
};
