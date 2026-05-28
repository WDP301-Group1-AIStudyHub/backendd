import { generateGroqTextFromPrompt } from "./groq.service";

export type SemanticQuestionIntent =
  | "qa"
  | "summary"
  | "comparison"
  | "extraction"
  | "instruction"
  | "list"
  | "unknown";

export interface IntentClassification {
  intent: SemanticQuestionIntent;
  confidence: number;
}

const VALID_INTENTS = new Set<SemanticQuestionIntent>([
  "qa",
  "summary",
  "comparison",
  "extraction",
  "instruction",
  "list",
  "unknown",
]);

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

const normalizeClassification = (
  parsed: Partial<IntentClassification> | null,
): IntentClassification => {
  const intent = parsed?.intent;
  const confidence = Number(parsed?.confidence);

  return {
    intent: intent && VALID_INTENTS.has(intent) ? intent : "unknown",
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
};

export const classifyQuestionIntent = async (
  question: string,
): Promise<IntentClassification> => {
  // Regex intent classifiers become brittle across languages, subjects, and
  // document formats. This model-driven classifier keeps RAG understanding
  // semantic while still returning a small typed contract for the pipeline.
  const prompt = `
Classify the user's question for a Vietnamese-focused educational document RAG system.
Vietnamese questions must keep their original meaning, accents, and subject-specific terms.
Do not use document-type assumptions.
Do not translate the question.
Return valid JSON only. Do not wrap the response in markdown.

Allowed intents:
- qa: normal question answering
- summary: user asks to summarize
- comparison: user asks to compare
- extraction: user asks to extract specific names, values, dates, entities, facts, or items
- instruction: user asks for steps, procedure, or what to do
- list: user asks for an enumerated list
- unknown: unclear intent

Expected JSON:
{
  "intent": "qa | summary | comparison | extraction | instruction | list | unknown",
  "confidence": 0.0
}

Question:
${question}
`;

  try {
    const response = await generateGroqTextFromPrompt(prompt, {
      temperature: 0,
      maxTokens: 120,
    });

    return normalizeClassification(parseJsonObject<IntentClassification>(response));
  } catch (error) {
    console.warn("[RAG intent classifier] Falling back to unknown intent", {
      error: error instanceof Error ? error.message : error,
    });

    return {
      intent: "unknown",
      confidence: 0,
    };
  }
};
