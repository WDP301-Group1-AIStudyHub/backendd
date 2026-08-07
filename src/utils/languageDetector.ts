export type DetectedLanguage = "vi" | "en" | "other";

const VIETNAMESE_DIACRITICS_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
const LATIN_LETTER_REGEX = /[a-z]/i;
const NON_ASCII_REGEX = /[^\x00-\x7F]/;

const UNACCENTED_VIETNAMESE_REGEX =
  /\b(noi dung|chuong|tai lieu|giao trinh|bai hoc|triet|mac|lenin|mln|tthcm|kttc|kttt|cau hoi|dap an|de thi|de muc|tom tat|phan tich|nguyen ly|quy luat|khai niem|y nghia|thuc tien|nhan thuc|vat chat|y thuc|la gi|nhu the nao|cho biet|hoc phan|mon hoc|chuong|cau|muc)\b/i;

export const detectQuestionLanguage = (question: string): DetectedLanguage => {
  if (
    VIETNAMESE_DIACRITICS_REGEX.test(question) ||
    UNACCENTED_VIETNAMESE_REGEX.test(question)
  ) {
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
