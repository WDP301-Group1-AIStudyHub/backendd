import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as groqService from "./groq.service";
import * as intentClassifierService from "./intentClassifier.service";
import { rewriteAcademicQuery } from "./queryRewrite.service";

const originalGenerateGroqTextFromPrompt =
  groqService.generateGroqTextFromPrompt;
const originalClassifyQuestionIntent =
  intentClassifierService.classifyQuestionIntent;

afterEach(() => {
  (
    groqService as unknown as {
      generateGroqTextFromPrompt: typeof groqService.generateGroqTextFromPrompt;
    }
  ).generateGroqTextFromPrompt = originalGenerateGroqTextFromPrompt;
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
      groqService as unknown as {
        generateGroqTextFromPrompt: typeof groqService.generateGroqTextFromPrompt;
      }
    ).generateGroqTextFromPrompt = async () =>
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
      groqService as unknown as {
        generateGroqTextFromPrompt: typeof groqService.generateGroqTextFromPrompt;
      }
    ).generateGroqTextFromPrompt = async () => "Rewritten query";

    const rewritten = await rewriteAcademicQuery("what is RAG?");

    assert.equal(classifierCalls, 1);
    assert.equal(rewritten, "Rewritten query");
  });

  it("returns the trimmed question unchanged for extraction intent", async () => {
    let groqCalls = 0;
    (
      groqService as unknown as {
        generateGroqTextFromPrompt: typeof groqService.generateGroqTextFromPrompt;
      }
    ).generateGroqTextFromPrompt = async () => {
      groqCalls += 1;
      return "should not be used";
    };

    const rewritten = await rewriteAcademicQuery("  ngày sinh của Mác?  ", {
      intent: "extraction",
    });

    assert.equal(groqCalls, 0);
    assert.equal(rewritten, "ngày sinh của Mác?");
  });

  it("falls back to the original question when the rewrite model fails", async () => {
    (
      groqService as unknown as {
        generateGroqTextFromPrompt: typeof groqService.generateGroqTextFromPrompt;
      }
    ).generateGroqTextFromPrompt = async () => {
      throw new Error("Groq unavailable");
    };

    const rewritten = await rewriteAcademicQuery("what is RAG?", {
      intent: "qa",
    });

    assert.equal(rewritten, "what is RAG?");
  });

  it("falls back to the original question when the rewrite is empty", async () => {
    (
      groqService as unknown as {
        generateGroqTextFromPrompt: typeof groqService.generateGroqTextFromPrompt;
      }
    ).generateGroqTextFromPrompt = async () => "";

    const rewritten = await rewriteAcademicQuery("what is RAG?", {
      intent: "qa",
    });

    assert.equal(rewritten, "what is RAG?");
  });
});
