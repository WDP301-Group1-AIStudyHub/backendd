import { detectQuestionLanguage } from "./languageDetector";

export type AnswerLanguage = "Vietnamese" | "English" | "other";

export type AnswerStyle = {
  language: AnswerLanguage;
  wantsShortAnswer: boolean;
  wantsList: boolean;
};

const SHORT_ANSWER_PATTERNS = [
  /\b(chỉ trả lời|ngắn gọn|trả lời ngắn|không giải thích)\b/i,
  /\b(only answer|just answer|short answer|briefly|no explanation)\b/i,
];

const LIST_PATTERNS = [
  /\b(liệt kê|những|các|danh sách)\b/i,
  /\b(list|enumerate|which|what are the)\b/i,
];

const ENGLISH_SIGNAL_REGEX =
  /\b(the|what|who|where|when|why|how|is|are|list|compare|define|summary|answer)\b/i;

const detectAnswerLanguage = (question: string): AnswerLanguage => {
  const detectedLanguage = detectQuestionLanguage(question);

  if (detectedLanguage === "vi") {
    return "Vietnamese";
  }

  if (/^[\x00-\x7F\s.,?!'"():;/-]+$/.test(question) || ENGLISH_SIGNAL_REGEX.test(question)) {
    return "English";
  }

  return "other";
};

export const detectAnswerStyle = (question: string): AnswerStyle => {
  return {
    language: detectAnswerLanguage(question),
    wantsShortAnswer: SHORT_ANSWER_PATTERNS.some((pattern) =>
      pattern.test(question),
    ),
    wantsList: LIST_PATTERNS.some((pattern) => pattern.test(question)),
  };
};

export const getInsufficientContextAnswer = (
  language: AnswerLanguage,
): string => {
  if (language === "Vietnamese") {
    return "Tôi không tìm thấy thông tin này trong tài liệu đã upload.";
  }

  return "I could not find this information in the uploaded document.";
};
