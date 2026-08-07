import { generateGeminiTextFromPrompt } from "./gemini.service";
import { detectQuestionLanguage, getLanguageName } from "../utils/languageDetector";
import {
  classifyQuestionIntent,
  SemanticQuestionIntent,
} from "./intentClassifier.service";

export const rewriteAcademicQuery = async (
  question: string,
  options: {
    // Pass the caller's already-classified intent to skip the extra
    // classification round trip; omitted only when no caller context exists.
    intent?: SemanticQuestionIntent;
    attempt?: number;
  } = {},
): Promise<string> => {
  const cleanQuestion = question.replace(/^["'«»“”`]+|["'«»“”`]+$/g, "").trim();
  const attempt = options.attempt ?? 1;
  const intent =
    options.intent ?? (await classifyQuestionIntent(cleanQuestion)).intent;
  const language = detectQuestionLanguage(cleanQuestion);

  if (intent === "extraction") {
    return cleanQuestion;
  }

  // Domain framing and instructions handle both accented and unaccented inputs.
  const isVietnamese = language === "vi";
  const domainLine = isVietnamese
    ? "Rewrite the user's question into a clear academic search query for retrieving passages from Vietnamese study documents."
    : "Rewrite the user's question into a clear academic search query for retrieving passages from the user's study documents.";
  const example = isVietnamese
    ? {
        question: "noi dung chuong 2 MLN",
        rewritten:
          "Nội dung chương 2 triết học Mác - Lênin",
      }
    : {
        question: "what's that thing about supply and demand?",
        rewritten: "Definition and explanation of the law of supply and demand",
      };

  const prompt = `
You are an expert query reformulation engine for an educational document RAG system.
Your task is to transform raw user input into an optimized, high-precision vector search query.

REWRITING RULES:
1. Preserve core semantic intent and specific tasks (definition, comparison, formula, procedure).
2. Retain all technical terms, entity names, dates, numbers, and formulas.
3. Language Normalization:
   - If input is Vietnamese without accents (e.g. "noi dung chuong 2 MLN"), restore full, grammatically correct diacritics.
   - Write the output query in the same language as the input prompt.
4. Expand standardized Vietnamese academic abbreviations:
   - "MLN" / "Triết" -> "Triết học Mác - Lênin"
   - "TTHCM" -> "Tư tưởng Hồ Chí Minh"
   - "KTTT" / "KTCT" -> "Kinh tế chính trị Mác - Lênin"
   - "CNXH" -> "Chủ nghĩa xã hội khoa học"
   - "LSĐ" -> "Lịch sử Đảng Cộng sản Việt Nam"
5. Do NOT over-generalize specific queries into broad topic titles.

OUTPUT CONSTRAINT:
Output ONLY the final rewritten search query string. Do not include quotes, explanations, markdown formatting, or system meta-text.

Example:
Question: ${example.question}
Rewritten query: ${example.rewritten}

Attempt: ${attempt}
Question: ${cleanQuestion}
Rewritten query:`;


  try {
    const rewritten = await generateGeminiTextFromPrompt(prompt, {
      temperature: 0,
      maxTokens: 120,
    });

    return (
      rewritten
        .replace(/^rewritten query:\s*/i, "")
        .replace(/^["'«»“”`]+|["'«»“”`]+$/g, "")
        .trim() || cleanQuestion
    );
  } catch (error) {
    // The rewrite only optimizes retrieval; a model outage must never fail
    // the whole question, so degrade to searching with the original text.
    console.warn("[RAG query rewrite] Falling back to original question", {
      error: error instanceof Error ? error.message : error,
    });

    return cleanQuestion;
  }
};

