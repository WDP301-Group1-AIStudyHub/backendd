import { BenchmarkEvaluationScore } from "../types/api.types";
import { generateGroqTextFromPrompt } from "./groq.service";

const clampScore = (score: unknown): number => {
  const value = Number(score);

  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
};

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

export const evaluateBenchmarkAnswer = async (
  question: string,
  expectedAnswer: string,
  actualAnswer: string,
): Promise<BenchmarkEvaluationScore> => {
  const prompt = `
You are a strict RAG benchmark evaluator.
Compare ACTUAL_ANSWER against EXPECTED_ANSWER for the QUESTION.
Return only JSON with this exact shape:
{
  "answerCorrectness": number,
  "faithfulness": number,
  "relevance": number,
  "completeness": number,
  "overallScore": number,
  "explanation": string
}

Rules:
- Scores must be from 0 to 1.
- answerCorrectness: factual match with expected answer.
- faithfulness: whether the answer avoids unsupported claims.
- relevance: whether it directly answers the question.
- completeness: whether it covers the important expected points.
- overallScore should be the average of the four scores.

QUESTION:
${question}

EXPECTED_ANSWER:
${expectedAnswer}

ACTUAL_ANSWER:
${actualAnswer}
`;

  const response = await generateGroqTextFromPrompt(prompt, {
    temperature: 0,
    maxTokens: 500,
  });
  const parsed = parseJsonObject<BenchmarkEvaluationScore>(response, {
    answerCorrectness: 0,
    faithfulness: 0,
    relevance: 0,
    completeness: 0,
    overallScore: 0,
    explanation: "Could not parse Groq evaluation response.",
  });

  const answerCorrectness = clampScore(parsed.answerCorrectness);
  const faithfulness = clampScore(parsed.faithfulness);
  const relevance = clampScore(parsed.relevance);
  const completeness = clampScore(parsed.completeness);
  const overallScore = clampScore(
    parsed.overallScore ||
      (answerCorrectness + faithfulness + relevance + completeness) / 4,
  );

  return {
    answerCorrectness,
    faithfulness,
    relevance,
    completeness,
    overallScore,
    explanation: parsed.explanation || "No explanation provided.",
  };
};
