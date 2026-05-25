import { generateGroqTextFromPrompt } from "./groq.service";

export const rewriteAcademicQuery = async (
  question: string,
  attempt = 1,
): Promise<string> => {
  const prompt = `
Rewrite the user's question into a clear academic search query for retrieving study document chunks.
Keep the meaning, add specific academic keywords when useful, and return only the rewritten query.

Attempt: ${attempt}
Original question: ${question}
`;

  const rewritten = await generateGroqTextFromPrompt(prompt, {
    temperature: 0,
    maxTokens: 120,
  });

  return rewritten.replace(/^["']|["']$/g, "").trim() || question;
};
