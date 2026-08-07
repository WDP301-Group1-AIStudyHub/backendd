import { generateGeminiTextFromPrompt } from "./gemini.service";

export type SemanticQuestionIntent =
  | "qa"
  | "summary"
  | "comparison"
  | "extraction"
  | "instruction"
  | "list"
  | "artifact_request"
  | "meta"
  | "unknown";

export interface IntentClassification {
  intent: SemanticQuestionIntent;
  requiresArtifact?: boolean;
  confidence: number;
}

const VALID_INTENTS = new Set<SemanticQuestionIntent>([
  "qa",
  "summary",
  "comparison",
  "extraction",
  "instruction",
  "list",
  "artifact_request",
  "meta",
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
    requiresArtifact: Boolean(parsed?.requiresArtifact),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
};

export const classifyQuestionIntent = async (
  question: string,
): Promise<IntentClassification> => {
  const prompt = `
You are an intent classification module for an educational RAG platform. 
Analyze the input user message and classify its primary intent and artifact requirements.

INTENT CATEGORIES:
- "qa": Standard factual Q&A, definitions, explanations.
- "summary": Requests to summarize documents, chapters, or topics.
- "comparison": Requests to compare concepts, entities, or theories.
- "extraction": Requests to extract specific entities, lists of dates, equations, or vocabulary.
- "instruction": Walkthroughs, procedural steps, problem-solving methods.
- "artifact_request": Explicit requests to generate flashcards, quizzes, mind maps, reports, or tables.
- "meta": System capabilities, greetings, small talk, or platform questions.
- "unknown": Ambiguous or unintelligible input.

JSON OUTPUT SCHEMA:
{
  "intent": "qa | summary | comparison | extraction | instruction | artifact_request | meta | unknown",
  "requiresArtifact": boolean,
  "confidence": 0.0
}

RULES:
- Return raw JSON ONLY. No markdown wrappers (do NOT use \`\`\`json), no preambles.
- Preserve original meaning of Vietnamese educational terms without translation.

Question:
${question}
`;

  try {
    const response = await generateGeminiTextFromPrompt(prompt, {
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
      requiresArtifact: false,
      confidence: 0,
    };
  }
};

