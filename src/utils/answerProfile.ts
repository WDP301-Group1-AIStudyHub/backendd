import type { SemanticQuestionIntent } from "../services/intentClassifier.service";

export type AnswerProfile = "brief" | "standard" | "detailed";

export type SectionReference = {
  keyword: string;
  rawValue: string;
  numericValue?: number;
};

export type AnswerProfileDetection = {
  profile: AnswerProfile;
  wantsDetailedAnswer: boolean;
  wantsShortAnswer: boolean;
  sectionReference?: SectionReference;
};

const VIETNAMESE_MARKS = /[\u0300-\u036f]/g;

export const normalizeForQuestionMatching = (text: string): string =>
  text
    .normalize("NFD")
    .replace(VIETNAMESE_MARKS, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const ROMAN_VALUES: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
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

const parseReferenceValue = (value: string): number | undefined => {
  const numeric = Number(value);

  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  return romanToNumber(value);
};

const SECTION_REFERENCE_PATTERN =
  /\b(chuong|chapter|phan|bai|muc|section)\s*(?:so\s*)?([0-9]+|[ivxlcdm]+)\b/i;

export const extractSectionReference = (
  question: string,
): SectionReference | undefined => {
  const normalizedQuestion = normalizeForQuestionMatching(question);
  const match = normalizedQuestion.match(SECTION_REFERENCE_PATTERN);

  if (!match) {
    return undefined;
  }

  return {
    keyword: match[1],
    rawValue: match[2],
    numericValue: parseReferenceValue(match[2]),
  };
};

const SHORT_ANSWER_PATTERN =
  /\b(ngan gon|tra loi nhanh|that ngan|tom tat ngan|short|brief|concise|quick answer)\b/i;

const DETAILED_ANSWER_PATTERN =
  /\b(noi dung|tom tat|tong quan|y chinh|giai thich|trinh bay|phan tich|diem can nho|overview|summary|explain|main ideas?|key points?)\b/i;

export const detectAnswerProfile = (
  question: string,
  intent: SemanticQuestionIntent = "unknown",
): AnswerProfileDetection => {
  const normalizedQuestion = normalizeForQuestionMatching(question);
  const sectionReference = extractSectionReference(question);
  const wantsShortAnswer = SHORT_ANSWER_PATTERN.test(normalizedQuestion);
  const asksForDetailedStudyAnswer =
    DETAILED_ANSWER_PATTERN.test(normalizedQuestion) || Boolean(sectionReference);
  const intentBenefitsFromDetail =
    intent === "summary" || intent === "comparison" || intent === "instruction";
  const wantsDetailedAnswer =
    !wantsShortAnswer && (asksForDetailedStudyAnswer || intentBenefitsFromDetail);

  return {
    profile: wantsShortAnswer
      ? "brief"
      : wantsDetailedAnswer
        ? "detailed"
        : "standard",
    wantsDetailedAnswer,
    wantsShortAnswer,
    sectionReference,
  };
};

export const shouldTreatAsSummaryIntent = (
  intent: SemanticQuestionIntent,
  profile: AnswerProfileDetection,
): boolean =>
  profile.wantsDetailedAnswer &&
  (intent === "unknown" || intent === "qa" || intent === "extraction");
