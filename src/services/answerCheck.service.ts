import { AnswerGroundingCheck } from "../types/rag.types";
import { generateGeminiTextFromPrompt } from "./gemini.service";

const parseJsonObject = <T>(text: string): T | null => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
};

export const checkAnswerGrounding = async (
  answer: string,
  context: string,
  options: {
    intent?: string;
    isMultiDocument?: boolean;
    allowIllustrativeExamples?: boolean;
  } = {},
): Promise<AnswerGroundingCheck> => {
  const isSummaryLike =
    options.intent === "summary" ||
    options.intent === "comparison" ||
    options.intent === "instruction";
  const paraphraseRules = isSummaryLike || options.isMultiDocument
    ? [
        "For summary or broad questions, allow synthesized answers that combine information from multiple context chunks.",
        "Paraphrasing and reorganising context information is acceptable as long as the meaning is preserved.",
        "For multi-document contexts, the answer may organise information by document, which is acceptable.",
      ].join("\n")
    : "";
  const illustrativeExampleRules = options.allowIllustrativeExamples
    ? [
        "The user explicitly requested practical examples or real-life application.",
        "Allow simple hypothetical or common-sense illustrative scenarios that correctly apply a principle supported by context, even if the exact scenario is not written in context.",
        "Theoretical claims must still be supported by context, and invented statistics, quotations, studies, dates, named people, or historical events are not allowed.",
      ].join("\n")
    : "";

  const prompt = `
You are a strict Hallucination and Grounding Evaluator for an educational RAG platform.
Evaluate whether the generated answer is fully supported by the provided context passages.

EVALUATION CRITERIA:
1. FACTUAL ACCURACY: Are all assertions, dates, names, and formulas in the answer directly backed by the context?
2. CITATION FAITHFULNESS: Do the bracketed citation markers (e.g., [1]) accurately point to the context passage that contains that fact?
3. EXTRAPOLATION CHECK: Does the answer contain unmentioned external facts or hallucinatory assumptions?

JSON OUTPUT FORMAT:
{
  "isGrounded": boolean,
  "citationAccuracy": 1.0,
  "confidenceScore": 1.0,
  "reason": "Short explanation of hallucination or missing context if isGrounded is false."
}

RULES:
- Set "isGrounded" to false if any factual claim lacks support in the provided context passages.
- Return raw JSON ONLY. No markdown code blocks, no intro/outro.
${paraphraseRules ? `\n${paraphraseRules}` : ""}
${illustrativeExampleRules ? `\n${illustrativeExampleRules}` : ""}

Context:
${context}

Answer:
${answer}
`;

  const text = await generateGeminiTextFromPrompt(prompt, {
    temperature: 0,
    maxTokens: 250,
  });

  const parsed = parseJsonObject<AnswerGroundingCheck>(text);

  if (!parsed) {
    return {
      isGrounded: false,
      confidenceScore: 0,
      citationAccuracy: 0,
      reason: "",
      warning: "Grounding check parse failed",
    };
  }

  const confidenceScore = Math.max(
    0,
    Math.min(1, Number(parsed.confidenceScore) || 0),
  );

  const citationAccuracy = Math.max(
    0,
    Math.min(1, Number(parsed.citationAccuracy) ?? 1.0),
  );

  const threshold =
    isSummaryLike ||
    options.isMultiDocument ||
    options.allowIllustrativeExamples
      ? 0.25
      : 0.4;

  return {
    isGrounded: Boolean(parsed.isGrounded) && confidenceScore >= threshold,
    confidenceScore,
    citationAccuracy,
    reason: parsed.reason,
    warning: parsed.warning,
  };
};
