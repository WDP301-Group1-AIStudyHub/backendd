import { AnswerGroundingCheck } from "../types/rag.types";
import { generateGroqTextFromPrompt } from "./groq.service";

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
  You are evaluating whether an answer for Vietnamese educational document QA is grounded in the provided context.
Return valid JSON only. Do not wrap it in markdown.
Expected JSON:
{
  "isGrounded": true,
  "confidenceScore": 0.0,
  "reason": "string"
}

Rules:
  - isGrounded must be false if the answer contains unsupported factual or theoretical claims.
- confidenceScore must be from 0 to 1.
- Vietnamese answers must preserve the meaning and terms found in the context.
- Do not require translation of Vietnamese educational terms.
- If the context is insufficient, isGrounded must be false so the backend can generate a safe fallback response.
  ${paraphraseRules ? `\n${paraphraseRules}` : ""}
  ${illustrativeExampleRules ? `\n${illustrativeExampleRules}` : ""}

  Context:
${context}

Answer:
${answer}
`;

  const text = await generateGroqTextFromPrompt(prompt, {
    temperature: 0,
    maxTokens: 250,
  });

  const parsed = parseJsonObject<AnswerGroundingCheck>(text);

  if (!parsed) {
    return {
      isGrounded: false,
      confidenceScore: 0,
      reason: "",
      warning: "Grounding check parse failed",
    };
  }

  const confidenceScore = Math.max(
    0,
    Math.min(1, Number(parsed.confidenceScore) || 0),
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
    reason: parsed.reason,
    warning: parsed.warning,
  };
};
