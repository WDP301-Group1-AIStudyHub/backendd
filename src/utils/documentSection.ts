import {
  detectSection,
  DocumentSection,
  normalizeSectionText,
} from "./sectionDetector";

export type { DocumentSection };

export const detectSectionFromHeading = (
  text: string,
): DocumentSection | null => {
  const normalizedText = normalizeSectionText(text);

  if (!normalizedText || normalizedText.length > 120) {
    return null;
  }

  const section = detectSection(normalizedText);

  return section === "UNKNOWN" ? null : section;
};

export const detectTargetSection = (
  question: string,
): DocumentSection | undefined => {
  const normalized = question.toLowerCase();

  if (
    /(kinh nghiệm làm việc|worked at|work experience|employment|company|công ty)/i.test(
      normalized,
    )
  ) {
    return "WORK_EXPERIENCE";
  }

  if (/(học ở đâu|education|academic|school|university|học vấn)/i.test(normalized)) {
    return "EDUCATION";
  }

  if (/(skill|skills|kỹ năng)/i.test(normalized)) {
    return "SKILLS";
  }

  if (/(project|projects|dự án)/i.test(normalized)) {
    return "PROJECT";
  }

  if (/(certification|certificate|chứng chỉ)/i.test(normalized)) {
    return "CERTIFICATIONS";
  }

  if (/(instruction|instructions|hướng dẫn|before doing)/i.test(normalized)) {
    return "INSTRUCTIONS";
  }

  return undefined;
};

export const sectionsMatch = (
  actualSection: DocumentSection,
  targetSection: DocumentSection,
): boolean => {
  if (actualSection === targetSection) {
    return true;
  }

  const workExperienceSections = new Set<DocumentSection>([
    "WORK_EXPERIENCE",
    "EXPERIENCE",
  ]);

  return (
    workExperienceSections.has(actualSection) &&
    workExperienceSections.has(targetSection)
  );
};
