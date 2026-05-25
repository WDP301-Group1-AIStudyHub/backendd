export type DocumentSection =
  | "WORK_EXPERIENCE"
  | "EXPERIENCE"
  | "EDUCATION"
  | "SKILLS"
  | "PROJECT"
  | "CERTIFICATIONS"
  | "INSTRUCTIONS"
  | "OBJECTIVE"
  | "QUESTIONS"
  | "SUMMARY"
  | "UNKNOWN";

type SectionPattern = {
  section: DocumentSection;
  pattern: RegExp;
};

const SECTION_PATTERNS: SectionPattern[] = [
  {
    section: "WORK_EXPERIENCE",
    pattern: /\b(WORK\s+EXPERIENCE|PROFESSIONAL\s+EXPERIENCE|EMPLOYMENT\s+HISTORY)\b/,
  },
  {
    section: "CERTIFICATIONS",
    pattern: /\b(CERTIFICATIONS?|CERTIFICATES?|CHỨNG\s+CHỈ)\b/,
  },
  {
    section: "INSTRUCTIONS",
    pattern: /\b(INSTRUCTIONS?|GUIDELINES?|HƯỚNG\s+DẪN)\b/,
  },
  {
    section: "EDUCATION",
    pattern: /\b(EDUCATION|ACADEMIC\s+BACKGROUND|HỌC\s+VẤN)\b/,
  },
  {
    section: "SKILLS",
    pattern: /\b(SKILLS|TECHNICAL\s+SKILLS|KỸ\s+NĂNG)\b/,
  },
  {
    section: "PROJECT",
    pattern: /\b(PROJECTS?|DỰ\s+ÁN)\b/,
  },
  {
    section: "OBJECTIVE",
    pattern: /\b(OBJECTIVE|CAREER\s+OBJECTIVE|MỤC\s+TIÊU)\b/,
  },
  {
    section: "QUESTIONS",
    pattern: /\b(QUESTIONS?|EXERCISES?|BÀI\s+TẬP|CÂU\s+HỎI)\b/,
  },
  {
    section: "SUMMARY",
    pattern: /\b(SUMMARY|ABSTRACT|TÓM\s+TẮT)\b/,
  },
  {
    section: "EXPERIENCE",
    pattern: /\bEXPERIENCE\b/,
  },
];

export const normalizeSectionText = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;.,|/\\-]+|[\s:;.,|/\\-]+$/g, "")
    .trim();

export const detectSection = (text: string): DocumentSection => {
  const normalizedText = normalizeSectionText(text);

  if (!normalizedText) {
    return "UNKNOWN";
  }

  return (
    SECTION_PATTERNS.find(({ pattern }) => pattern.test(normalizedText))
      ?.section ?? "UNKNOWN"
  );
};
