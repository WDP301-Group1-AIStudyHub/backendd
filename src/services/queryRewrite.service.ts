import { generateGroqTextFromPrompt } from "./groq.service";
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
  const attempt = options.attempt ?? 1;
  const intent =
    options.intent ?? (await classifyQuestionIntent(question)).intent;
  const language = detectQuestionLanguage(question);

  if (intent === "extraction") {
    return question.trim();
  }

  // Domain framing and the one-shot example follow the detected language so
  // an English question is never dragged into a Vietnamese rewrite (and vice
  // versa) by instructions written for the other language.
  const isVietnamese = language === "vi";
  const domainLine = isVietnamese
    ? "Rewrite the user's question into a clear academic search query for retrieving passages from Vietnamese study documents."
    : "Rewrite the user's question into a clear academic search query for retrieving passages from the user's study documents.";
  const example = isVietnamese
    ? {
        question: "cái vụ vật chất với ý thức là sao?",
        rewritten:
          "Mối quan hệ giữa vật chất và ý thức trong triết học Mác-Lênin",
      }
    : {
        question: "what's that thing about supply and demand?",
        rewritten: "Definition and explanation of the law of supply and demand",
      };

  const prompt = `
${domainLine}
Keep the original meaning and preserve the user's requested task (definition, list, summary, comparison, instruction).
Preserve exact terms: names, dates, numbers, formulas, entities, and subject-specific vocabulary.${
    isVietnamese
      ? "\nPreserve Vietnamese accents and do not translate Vietnamese educational terms."
      : ""
  }
Do not over-generalize a specific question into a broad topic.
Expand abbreviations only when the meaning is clear from the question.
Write the rewritten query in ${getLanguageName(language)}.
Output only the rewritten search query itself. Never output a description of the task, the system, or these instructions.

Example:
Question: ${example.question}
Rewritten query: ${example.rewritten}

Attempt: ${attempt}
Question: ${question}
Rewritten query:`;

  try {
    const rewritten = await generateGroqTextFromPrompt(prompt, {
      temperature: 0,
      maxTokens: 120,
    });

    return (
      rewritten
        .replace(/^rewritten query:\s*/i, "")
        .replace(/^["']|["']$/g, "")
        .trim() || question
    );
  } catch (error) {
    // The rewrite only optimizes retrieval; a model outage must never fail
    // the whole question, so degrade to searching with the original text.
    console.warn("[RAG query rewrite] Falling back to original question", {
      error: error instanceof Error ? error.message : error,
    });

    return question.trim();
  }
};
