export type DetectedLanguage = "vi" | "en";

const VIETNAMESE_DIACRITICS_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

const VIETNAMESE_WORDS = new Set([
  "bạn",
  "của",
  "trong",
  "này",
  "những",
  "nơi",
  "làm",
  "việc",
  "kinh",
  "nghiệm",
  "chỉ",
  "trả",
  "lời",
  "ngắn",
  "gọn",
  "công",
  "ty",
]);

export const detectQuestionLanguage = (question: string): DetectedLanguage => {
  if (VIETNAMESE_DIACRITICS_REGEX.test(question)) {
    return "vi";
  }

  const terms = question.toLowerCase().split(/\s+/);
  const vietnameseMatches = terms.filter((term) =>
    VIETNAMESE_WORDS.has(term),
  ).length;

  return vietnameseMatches >= 2 ? "vi" : "en";
};

export const getLanguageName = (language: DetectedLanguage): string =>
  language === "vi" ? "Vietnamese" : "English";
