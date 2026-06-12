import { detectQuestionLanguage } from "./languageDetector";

export type AnswerLanguage = "Vietnamese" | "English" | "other";

export type AnswerStyle = {
  language: AnswerLanguage;
  wantsShortAnswer: boolean;
  wantsList: boolean;
};

const detectAnswerLanguage = (question: string): AnswerLanguage => {
  const detectedLanguage = detectQuestionLanguage(question);

  if (detectedLanguage === "vi") {
    return "Vietnamese";
  }

  if (detectedLanguage === "en") {
    return "English";
  }

  return "other";
};

export const detectAnswerStyle = (question: string): AnswerStyle => {
  return {
    language: detectAnswerLanguage(question),
    // Formatting preferences are handled semantically by the LLM prompt.
    // This avoids maintaining brittle multilingual keyword dictionaries.
    wantsShortAnswer: false,
    wantsList: false,
  };
};
