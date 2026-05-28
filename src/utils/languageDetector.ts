export type DetectedLanguage = "vi" | "en" | "other";

const VIETNAMESE_DIACRITICS_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const LATIN_LETTER_REGEX = /[a-z]/i;
const NON_ASCII_REGEX = /[^\x00-\x7F]/;

export const detectQuestionLanguage = (question: string): DetectedLanguage => {
  if (VIETNAMESE_DIACRITICS_REGEX.test(question)) {
    return "vi";
  }

  if (!NON_ASCII_REGEX.test(question) && LATIN_LETTER_REGEX.test(question)) {
    return "en";
  }

  return "other";
};

export const getLanguageName = (language: DetectedLanguage): string => {
  if (language === "vi") {
    return "Vietnamese";
  }

  if (language === "en") {
    return "English";
  }

  return "the same language as the question";
};
