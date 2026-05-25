import { generateGroqTextFromPrompt } from "./groq.service";
import { detectQuestionLanguage, getLanguageName } from "../utils/languageDetector";
import { detectQuestionIntent } from "../utils/ragIntent";

export const rewriteAcademicQuery = async (
  question: string,
  attempt = 1,
): Promise<string> => {
  const intent = detectQuestionIntent(question);
  const language = detectQuestionLanguage(question);

  if (intent === "entity_extraction") {
    return question.trim();
  }

  const prompt = `
Rewrite the user's question into a clear academic search query for retrieving study document chunks.
Keep the meaning, add specific keywords when useful, and return only the rewritten query.
Do not broaden specific questions into unrelated topics.
Preserve requested entities, constraints, names, dates, emails, categories, and exact terms from the question.
For definitions, instructions, lists, summaries, and comparisons, preserve the user's requested task.
Use the same language as the original question: ${getLanguageName(language)}.

Attempt: ${attempt}
Original question: ${question}
`;

  const rewritten = await generateGroqTextFromPrompt(prompt, {
    temperature: 0,
    maxTokens: 120,
  });

  return rewritten.replace(/^["']|["']$/g, "").trim() || question;
};
