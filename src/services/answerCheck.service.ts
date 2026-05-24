import { AnswerGroundingCheck } from "../types/rag.types";
import { generateGeminiText } from "./embedding.service";

const parseJsonObject = <T>(text: string, fallback: T): T => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return fallback;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return fallback;
  }
};

export const checkAnswerGrounding = async (
  answer: string,
  context: string,
): Promise<AnswerGroundingCheck> => {
  const prompt = `
You are evaluating whether an answer is grounded only in the provided context.
Return only JSON with this shape:
{"isGrounded": boolean, "confidenceScore": number, "warning": string}

Context:
${context}

Answer:
${answer}
`;

  const text = await generateGeminiText(prompt);

  const parsed = parseJsonObject<AnswerGroundingCheck>(text, {
    isGrounded: false,
    confidenceScore: 0.3,
    warning: "Could not parse grounding check result.",
  });

  return {
    isGrounded: Boolean(parsed.isGrounded),
    confidenceScore: Math.max(0, Math.min(1, Number(parsed.confidenceScore) || 0)),
    warning: parsed.warning,
  };
};
