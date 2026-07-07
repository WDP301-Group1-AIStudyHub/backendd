import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as geminiService from "./gemini.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";

const originalGenerateGeminiText = geminiService.generateGeminiText;

type GeminiTextMessages = Parameters<typeof geminiService.generateGeminiText>[0];

const mockGeminiText = (
  handler: (messages: GeminiTextMessages) => Promise<string>,
): { calls: GeminiTextMessages[] } => {
  const calls: GeminiTextMessages[] = [];

  (
    geminiService as unknown as {
      generateGeminiText: typeof geminiService.generateGeminiText;
    }
  ).generateGeminiText = async (messages) => {
    calls.push(messages);
    return handler(messages);
  };

  return { calls };
};

afterEach(() => {
  (
    geminiService as unknown as {
      generateGeminiText: typeof geminiService.generateGeminiText;
    }
  ).generateGeminiText = originalGenerateGeminiText;
});

describe("fallback answer generation", () => {
  it("returns the deterministic message without an LLM call for standard answers", async () => {
    const gemini = mockGeminiText(async () => "should not be used");

    const answer = await generateFallbackAnswer({
      question: "Trình bày quy luật lượng chất?",
      language: "Vietnamese",
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      reason: "no_relevant_chunks_found",
    });

    assert.equal(gemini.calls.length, 0);
    assert.match(answer, /chưa tìm thấy đoạn nội dung liên quan/i);
    assert.doesNotMatch(answer, /re-index/i);
  });

  it("stays deterministic for out-of-scope even with a detailed profile", async () => {
    const gemini = mockGeminiText(async () => "should not be used");

    const answer = await generateFallbackAnswer({
      question: "xe máy có mấy bánh",
      language: "Vietnamese",
      retrievedChunksCount: 4,
      relevantChunksCount: 0,
      averageRelevanceScore: 0.41,
      reason: "out_of_scope",
      answerProfile: "detailed",
    });

    assert.equal(gemini.calls.length, 0);
    assert.match(answer, /không liên quan/i);
  });

  it("uses the LLM for detailed profiles without embedding the user question", async () => {
    const question = "So sánh chi tiết chương 1 và chương 2 của tài liệu?";
    const gemini = mockGeminiText(async () => "## Vấn đề\nKhông đủ ngữ cảnh.");

    const answer = await generateFallbackAnswer({
      question,
      language: "Vietnamese",
      retrievedChunksCount: 3,
      relevantChunksCount: 0,
      averageRelevanceScore: 0.35,
      reason: "retrieved_chunks_not_relevant_enough",
      answerProfile: "detailed",
    });

    assert.equal(gemini.calls.length, 1);
    assert.equal(answer, "## Vấn đề\nKhông đủ ngữ cảnh.");

    const promptContent = String(gemini.calls[0][0]?.content ?? "");
    assert.ok(!promptContent.includes(question));
    assert.ok(promptContent.includes("retrievedChunksCount: 3"));
    assert.ok(promptContent.includes("Vấn đề"));
  });

  it("degrades to the deterministic message when the LLM call fails", async () => {
    mockGeminiText(async () => {
      throw new Error("Gemini unavailable");
    });

    const answer = await generateFallbackAnswer({
      question: "Explain the document in detail",
      language: "English",
      retrievedChunksCount: 2,
      relevantChunksCount: 0,
      averageRelevanceScore: 0.3,
      reason: "grounding_failed",
      answerProfile: "detailed",
    });

    assert.match(answer, /not well supported/i);
    assert.doesNotMatch(answer, /re-index/i);
  });

  it("falls back to English wording for undetected languages", async () => {
    const gemini = mockGeminiText(async () => "should not be used");

    const answer = await generateFallbackAnswer({
      question: "文書の内容を教えて",
      language: "other",
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
    });

    assert.equal(gemini.calls.length, 0);
    assert.match(answer, /could not find any relevant passages/i);
  });

  it("infers the reason from retrieval statistics when none is provided", async () => {
    mockGeminiText(async () => "should not be used");

    const answer = await generateFallbackAnswer({
      question: "What does chapter 3 say?",
      language: "English",
      retrievedChunksCount: 5,
      relevantChunksCount: 0,
      averageRelevanceScore: 0.2,
    });

    assert.match(answer, /not relevant enough/i);
  });
});
