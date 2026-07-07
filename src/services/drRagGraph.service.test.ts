import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as answerCheckService from "./answerCheck.service";
import * as chatScopeService from "./chatScope.service";
import * as fallbackAnswerService from "./fallbackAnswer.service";
import * as geminiService from "./gemini.service";
import * as intentClassifierService from "./intentClassifier.service";
import * as queryRewriteService from "./queryRewrite.service";
import * as vectorService from "./vector.service";
import { askQuestionWithDrRagGraph } from "./drRagGraph.service";
import { DOCUMENT_PROCESSING_MESSAGE } from "./drRag.service";
import type { EvaluatedChunk } from "../types/rag.types";

const originalResolveChatScope = chatScopeService.resolveChatScope;
const originalSearchRelevantChunks = vectorService.searchRelevantChunks;
const originalClassifyQuestionIntent =
  intentClassifierService.classifyQuestionIntent;
const originalRewriteAcademicQuery = queryRewriteService.rewriteAcademicQuery;
const originalGenerateAnswerFromContext = geminiService.generateAnswerFromContext;
const originalCheckAnswerGrounding = answerCheckService.checkAnswerGrounding;
const originalGenerateFallbackAnswer =
  fallbackAnswerService.generateFallbackAnswer;

const makeChunk = (
  id: string,
  content: string,
  metadata: Partial<EvaluatedChunk["metadata"]> = {},
): EvaluatedChunk => ({
  id,
  content,
  pineconeScore: 0.9,
  metadata: {
    documentId: "doc-1",
    userId: "user-1",
    subject: "WDP301",
    subjectId: "subject-1",
    title: "Prog Rock Notes",
    chunkIndex: 0,
    ...metadata,
  },
  relevanceScore: 0.9,
  isRelevant: true,
});

const staticChunkA = makeChunk(
  "doc-1:0",
  "Green is the fourth studio album by Steve Hillage, a British progressive rock performer.",
  { sectionTitle: "Album overview", chunkIndex: 0 },
);
const staticChunkB = makeChunk(
  "doc-1:1",
  "Steve Hillage recorded Green in 1978 after touring with the band Gong.",
  { sectionTitle: "Recording history", chunkIndex: 1 },
);
const dynamicChunk = {
  ...makeChunk(
    "doc-1:5",
    "Miquette Giraudy is the longtime partner of Steve Hillage and plays keyboards on Green.",
    { sectionTitle: "Personal life", chunkIndex: 5 },
  ),
  pineconeScore: 0.8,
};

const mockScope = () => {
  (
    chatScopeService as unknown as {
      resolveChatScope: typeof chatScopeService.resolveChatScope;
    }
  ).resolveChatScope = async () => ({
    scope: "library_all",
    hasProcessingDocument: false,
    vectorFilters: { userId: "user-1" },
    isMultiDocumentScope: false,
  });
};

const mockIntentAndRewrite = () => {
  (
    intentClassifierService as unknown as {
      classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
    }
  ).classifyQuestionIntent = async () => ({
    intent: "qa",
    confidence: 0.9,
  });
  (
    queryRewriteService as unknown as {
      rewriteAcademicQuery: typeof queryRewriteService.rewriteAcademicQuery;
    }
  ).rewriteAcademicQuery = async (question: string) => question;
};

const mockRetrieval = (): string[] => {
  const calls: string[] = [];

  (
    vectorService as unknown as {
      searchRelevantChunks: typeof vectorService.searchRelevantChunks;
    }
  ).searchRelevantChunks = async (queryOrEmbedding) => {
    const query = Array.isArray(queryOrEmbedding)
      ? queryOrEmbedding.join(" ")
      : String(queryOrEmbedding);
    calls.push(query);

    if (query.includes("Known context:")) {
      return [dynamicChunk];
    }

    return [staticChunkA, staticChunkB];
  };

  return calls;
};

const mockGeneration = (answer: string) => {
  (
    geminiService as unknown as {
      generateAnswerFromContext: typeof geminiService.generateAnswerFromContext;
    }
  ).generateAnswerFromContext = async () => answer;
};

const mockGrounding = (
  grounding: Awaited<ReturnType<typeof answerCheckService.checkAnswerGrounding>>,
) => {
  (
    answerCheckService as unknown as {
      checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
    }
  ).checkAnswerGrounding = async () => grounding;
};

const mockFallbackAnswer = (answer: string) => {
  (
    fallbackAnswerService as unknown as {
      generateFallbackAnswer: typeof fallbackAnswerService.generateFallbackAnswer;
    }
  ).generateFallbackAnswer = async () => answer;
};

afterEach(() => {
  (
    chatScopeService as unknown as {
      resolveChatScope: typeof chatScopeService.resolveChatScope;
    }
  ).resolveChatScope = originalResolveChatScope;
  (
    vectorService as unknown as {
      searchRelevantChunks: typeof vectorService.searchRelevantChunks;
    }
  ).searchRelevantChunks = originalSearchRelevantChunks;
  (
    intentClassifierService as unknown as {
      classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
    }
  ).classifyQuestionIntent = originalClassifyQuestionIntent;
  (
    queryRewriteService as unknown as {
      rewriteAcademicQuery: typeof queryRewriteService.rewriteAcademicQuery;
    }
  ).rewriteAcademicQuery = originalRewriteAcademicQuery;
  (
    geminiService as unknown as {
      generateAnswerFromContext: typeof geminiService.generateAnswerFromContext;
    }
  ).generateAnswerFromContext = originalGenerateAnswerFromContext;
  (
    answerCheckService as unknown as {
      checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
    }
  ).checkAnswerGrounding = originalCheckAnswerGrounding;
  (
    fallbackAnswerService as unknown as {
      generateFallbackAnswer: typeof fallbackAnswerService.generateFallbackAnswer;
    }
  ).generateFallbackAnswer = originalGenerateFallbackAnswer;
});

describe("DR-RAG graph", () => {
  it("runs the QDC fan-out per static seed and answers from combined context", async () => {
    mockScope();
    mockIntentAndRewrite();
    const retrievalCalls = mockRetrieval();
    mockGeneration("The partner is Miquette Giraudy.");
    mockGrounding({ isGrounded: true, confidenceScore: 0.92 });

    const result = await askQuestionWithDrRagGraph("user-1", {
      question: "Who is the partner of the performer who recorded Green?",
    });

    assert.equal(result.answer, "The partner is Miquette Giraudy.");
    assert.equal(result.mode, "dr-rag");
    // one stage-one search + one QDC branch per static seed
    assert.equal(retrievalCalls.length, 3);
    assert.ok(retrievalCalls[1].includes("Known context:"));
    assert.ok(retrievalCalls[2].includes("Known context:"));
    assert.equal(result.evaluation.stageOneChunksCount, 2);
    assert.equal(result.evaluation.selectedStaticChunksCount, 2);
    assert.equal(result.evaluation.selectedDynamicChunksCount, 1);
    assert.equal(result.evaluation.dynamicRetrievalAttempted, true);
    assert.equal(result.evaluation.retrievalQueries?.length, 3);
    assert.equal(result.evaluation.isGrounded, true);
    assert.equal(result.evaluation.fallbackGenerated, false);
    assert.ok(result.sources.length >= 3);
    assert.ok(
      result.sources.some((source) => source.sectionTitle === "Personal life"),
    );
  });

  it("falls back without fan-out when stage one retrieves nothing", async () => {
    mockScope();
    mockIntentAndRewrite();
    const retrievalCalls: string[] = [];
    (
      vectorService as unknown as {
        searchRelevantChunks: typeof vectorService.searchRelevantChunks;
      }
    ).searchRelevantChunks = async (queryOrEmbedding) => {
      retrievalCalls.push(String(queryOrEmbedding));
      return [];
    };
    mockFallbackAnswer("Fallback answer");

    const result = await askQuestionWithDrRagGraph("user-1", {
      question: "Who is the partner of the performer who recorded Green?",
    });

    assert.equal(result.answer, "Fallback answer");
    assert.equal(retrievalCalls.length, 1);
    assert.equal(result.evaluation.fallbackGenerated, true);
    assert.equal(result.evaluation.fallbackReason, "no_relevant_chunks_found");
    assert.equal(result.evaluation.isGrounded, false);
    assert.equal(result.evaluation.stageOneChunksCount, 0);
    assert.equal(result.sources.length, 0);
  });

  it("routes ungrounded answers to the fallback while keeping sources", async () => {
    mockScope();
    mockIntentAndRewrite();
    mockRetrieval();
    mockGeneration("A hallucinated claim.");
    mockGrounding({
      isGrounded: false,
      confidenceScore: 0.2,
      warning: "Answer not supported by context",
    });
    mockFallbackAnswer("Fallback for ungrounded answer");

    const result = await askQuestionWithDrRagGraph("user-1", {
      question: "Who is the partner of the performer who recorded Green?",
    });

    assert.equal(result.answer, "Fallback for ungrounded answer");
    assert.equal(result.evaluation.fallbackGenerated, true);
    assert.equal(result.evaluation.fallbackReason, "grounding_failed");
    assert.equal(result.evaluation.isGrounded, false);
    assert.equal(result.evaluation.confidenceScore, 0.2);
    assert.ok(result.sources.length >= 3);
  });

  it("answers meta questions about the assistant without retrieval", async () => {
    mockScope();
    (
      intentClassifierService as unknown as {
        classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
      }
    ).classifyQuestionIntent = async () => ({
      intent: "meta",
      confidence: 0.95,
    });
    const retrievalCalls: string[] = [];
    (
      vectorService as unknown as {
        searchRelevantChunks: typeof vectorService.searchRelevantChunks;
      }
    ).searchRelevantChunks = async (queryOrEmbedding) => {
      retrievalCalls.push(String(queryOrEmbedding));
      return [];
    };

    const result = await askQuestionWithDrRagGraph("user-1", {
      question: "what can you do?",
    });

    assert.equal(retrievalCalls.length, 0);
    assert.match(result.answer, /study assistant/i);
    assert.equal(result.evaluation.detectedIntent, "meta");
    assert.equal(result.evaluation.isGrounded, true);
    assert.equal(result.evaluation.fallbackGenerated, false);
    assert.equal(result.sources.length, 0);
  });

  it("short-circuits with the processing message while documents are indexing", async () => {
    (
      chatScopeService as unknown as {
        resolveChatScope: typeof chatScopeService.resolveChatScope;
      }
    ).resolveChatScope = async () => ({
      scope: "library_all",
      hasProcessingDocument: true,
      vectorFilters: { userId: "user-1" },
      isMultiDocumentScope: false,
    });
    const retrievalCalls: string[] = [];
    (
      vectorService as unknown as {
        searchRelevantChunks: typeof vectorService.searchRelevantChunks;
      }
    ).searchRelevantChunks = async (queryOrEmbedding) => {
      retrievalCalls.push(String(queryOrEmbedding));
      return [];
    };

    const result = await askQuestionWithDrRagGraph("user-1", {
      question: "Who is the partner of the performer who recorded Green?",
    });

    assert.equal(result.answer, DOCUMENT_PROCESSING_MESSAGE);
    assert.equal(result.evaluation.fallbackReason, "document_processing");
    assert.equal(result.evaluation.fallbackGenerated, true);
    assert.equal(retrievalCalls.length, 0);
  });
});
