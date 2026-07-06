import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as geminiService from "./gemini.service";
import * as intentClassifierService from "./intentClassifier.service";
import { rewriteAcademicQuery } from "./queryRewrite.service";

const originalGenerateGeminiTextFromPrompt =
  geminiService.generateGeminiTextFromPrompt;
const originalClassifyQuestionIntent =
  intentClassifierService.classifyQuestionIntent;

afterEach(() => {
  (
    geminiService as unknown as {
      generateGeminiTextFromPrompt: typeof geminiService.generateGeminiTextFromPrompt;
    }
  ).generateGeminiTextFromPrompt = originalGenerateGeminiTextFromPrompt;
  (
    intentClassifierService as unknown as {
      classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
    }
  ).classifyQuestionIntent = originalClassifyQuestionIntent;
});

describe("academic query rewrite", () => {
  it("skips intent classification when the caller provides the intent", async () => {
    let classifierCalls = 0;
    (
      intentClassifierService as unknown as {
        classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
      }
    ).classifyQuestionIntent = async () => {
      classifierCalls += 1;
      return { intent: "qa", confidence: 0.9 };
    };
    (
      geminiService as unknown as {
        generateGeminiTextFromPrompt: typeof geminiService.generateGeminiTextFromPrompt;
      }
    ).generateGeminiTextFromPrompt = async () =>
      '"Mối quan hệ giữa vật chất và ý thức"';

    const rewritten = await rewriteAcademicQuery(
      "cái vụ vật chất với ý thức là sao?",
      { intent: "qa" },
    );

    assert.equal(classifierCalls, 0);
    assert.equal(rewritten, "Mối quan hệ giữa vật chất và ý thức");
  });

  it("classifies internally only when no intent is provided", async () => {
    let classifierCalls = 0;
    (
      intentClassifierService as unknown as {
        classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
      }
    ).classifyQuestionIntent = async () => {
      classifierCalls += 1;
      return { intent: "qa", confidence: 0.9 };
    };
    (
      geminiService as unknown as {
        generateGeminiTextFromPrompt: typeof geminiService.generateGeminiTextFromPrompt;
      }
    ).generateGeminiTextFromPrompt = async () => "Rewritten query";

    const rewritten = await rewriteAcademicQuery("what is RAG?");

    assert.equal(classifierCalls, 1);
    assert.equal(rewritten, "Rewritten query");
  });

  it("returns the trimmed question unchanged for extraction intent", async () => {
    let geminiCalls = 0;
    (
      geminiService as unknown as {
        generateGeminiTextFromPrompt: typeof geminiService.generateGeminiTextFromPrompt;
      }
    ).generateGeminiTextFromPrompt = async () => {
      geminiCalls += 1;
      return "should not be used";
    };

    const rewritten = await rewriteAcademicQuery("  ngày sinh của Mác?  ", {
      intent: "extraction",
    });

    assert.equal(geminiCalls, 0);
    assert.equal(rewritten, "ngày sinh của Mác?");
  });

  it("falls back to the original question when the rewrite model fails", async () => {
    (
      geminiService as unknown as {
        generateGeminiTextFromPrompt: typeof geminiService.generateGeminiTextFromPrompt;
      }
    ).generateGeminiTextFromPrompt = async () => {
      throw new Error("Gemini unavailable");
    };

    const rewritten = await rewriteAcademicQuery("what is RAG?", {
      intent: "qa",
    });

    assert.equal(rewritten, "what is RAG?");
  });

  it("falls back to the original question when the rewrite is empty", async () => {
    (
      geminiService as unknown as {
        generateGeminiTextFromPrompt: typeof geminiService.generateGeminiTextFromPrompt;
      }
    ).generateGeminiTextFromPrompt = async () => "";

    const rewritten = await rewriteAcademicQuery("what is RAG?", {
      intent: "qa",
    });

    assert.equal(rewritten, "what is RAG?");
  });
});
