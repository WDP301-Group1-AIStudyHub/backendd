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
): Promise<AnswerGroundingCheck> => {
  const prompt = `
You are evaluating whether an answer for Vietnamese educational document QA is grounded only in the provided context.
Return valid JSON only. Do not wrap it in markdown.
Expected JSON:
{
  "isGrounded": true,
  "confidenceScore": 0.0,
  "reason": "string"
}

Rules:
- isGrounded must be false if the answer contains claims not supported by context.
- confidenceScore must be from 0 to 1.
- Vietnamese answers must preserve the meaning and terms found in the context.
- Do not require translation of Vietnamese educational terms.
- If the context is insufficient, the answer should be exactly: "Tôi không tìm thấy thông tin này trong tài liệu đã upload."

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

  return {
    isGrounded: Boolean(parsed.isGrounded) && confidenceScore >= 0.4,
    confidenceScore,
    reason: parsed.reason,
    warning: parsed.warning,
  };
};
