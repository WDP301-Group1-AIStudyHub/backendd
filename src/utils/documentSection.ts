export type SectionLabel = string;

const MARKDOWN_HEADING_REGEX = /^\s{0,3}#{1,6}\s+(.+)$/;
const PAGE_MARKER_REGEX = /^-*\s*\d+\s+of\s+\d+\s*-*$/i;
const NUMERIC_ONLY_HEADING_REGEX = /^\d+$/;
const NUMBERED_HEADING_REGEX =
  /^((\d+(\.\d+)+\.?|\d+\.)|((CHAPTER|SECTION|CHUONG|PHAN|BAI|CH\u01af\u01a0NG|PH\u1ea6N|B\u00c0I)\s+\d+(\.\d+)*))(\s+.+)?$/iu;
const KEYWORD_HEADING_REGEX =
  /^(CHAPTER|SECTION|CHUONG|PHAN|BAI|CH\u01af\u01a0NG|PH\u1ea6N|B\u00c0I)(\s+\d+(\.\d+)*)?(\s*[:.-]\s*|\s+).+$/iu;
const ENDING_PUNCTUATION_REGEX = /[.!?\u3002\uff01\uff1f]$/;

export const normalizeHeadingCandidate = (text: string): string =>
  text
    .replace(MARKDOWN_HEADING_REGEX, "$1")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s#:;.,|/\\-]+|[\s#:;.,|/\\-]+$/g, "")
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

export const isDocumentNoiseLine = (line: string): boolean => {
  const normalizedText = normalizeHeadingCandidate(line);

  return (
    PAGE_MARKER_REGEX.test(normalizedText) ||
    NUMERIC_ONLY_HEADING_REGEX.test(normalizedText)
  );
};

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

  if (isDocumentNoiseLine(line)) {
    return false;
  }

  const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
  const uppercaseRatio = getUppercaseRatio(line);
  const isMarkdownHeading = MARKDOWN_HEADING_REGEX.test(line);
  const isNumberedHeading = NUMBERED_HEADING_REGEX.test(normalizedText);
  const isKeywordHeading = KEYWORD_HEADING_REGEX.test(normalizedText);
  const startsNewBlock = isBlank(previousLine);
  const followedByContent = Boolean((nextContentLine ?? nextLine)?.trim());
  const hasEndingPunctuation = ENDING_PUNCTUATION_REGEX.test(trimmedLine);

  if (
    hasEndingPunctuation &&
    !isMarkdownHeading &&
    !isNumberedHeading &&
    !isKeywordHeading
  ) {
    return false;
  }

  const formatLooksLikeHeading =
    isMarkdownHeading ||
    isNumberedHeading ||
    isKeywordHeading ||
    uppercaseRatio >= 0.65 ||
    (wordCount <= 8 && normalizedText.length <= 80 && startsNewBlock);

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
