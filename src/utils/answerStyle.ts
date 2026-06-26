import { detectQuestionLanguage } from "./languageDetector";
import { detectAnswerProfile } from "./answerProfile";

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
  const profile = detectAnswerProfile(question);

  return {
    language: detectAnswerLanguage(question),
    wantsShortAnswer: profile.wantsShortAnswer,
    wantsList: false,
  };
};
