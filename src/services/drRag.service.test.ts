import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as answerCheckService from "./answerCheck.service";
import * as chatScopeService from "./chatScope.service";
import * as groqService from "./groq.service";
import * as intentClassifierService from "./intentClassifier.service";
import * as queryRewriteService from "./queryRewrite.service";
import * as vectorService from "./vector.service";
import {
  askQuestionWithDrRag,
  buildExpandedRetrievalQuery,
  hasSufficientStageOneEvidence,
} from "./drRag.service";
import type { EvaluatedChunk } from "../types/rag.types";
import { generateFallbackAnswer } from "./fallbackAnswer.service";

const originalResolveChatScope = chatScopeService.resolveChatScope;
const originalSearchRelevantChunks = vectorService.searchRelevantChunks;
const originalClassifyQuestionIntent =
  intentClassifierService.classifyQuestionIntent;
const originalRewriteAcademicQuery = queryRewriteService.rewriteAcademicQuery;
const originalGenerateAnswerFromContext = groqService.generateAnswerFromContext;
const originalCheckAnswerGrounding = answerCheckService.checkAnswerGrounding;

const makeEvaluatedChunk = (
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
    title: "RAG Notes",
    chunkIndex: 0,
    ...metadata,
  },
  relevanceScore: 0.9,
  isRelevant: true,
});

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
    groqService as unknown as {
      generateAnswerFromContext: typeof groqService.generateAnswerFromContext;
    }
  ).generateAnswerFromContext = originalGenerateAnswerFromContext;
  (
    answerCheckService as unknown as {
      checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
    }
  ).checkAnswerGrounding = originalCheckAnswerGrounding;
});

describe("DR-RAG retrieval", () => {
  it("rejects stage-one results that have no document topic evidence", () => {
    const unrelatedChunk = {
      ...makeEvaluatedChunk(
        "doc-1:0",
        "Triết học Mác - Lênin nghiên cứu vật chất và ý thức.",
      ),
      pineconeScore: 0.42,
      relevanceScore: 0.42,
    };

    assert.equal(
      hasSufficientStageOneEvidence(
        "xe máy có mấy bánh",
        [unrelatedChunk],
      ),
      false,
    );
  });

  it("keeps semantically or lexically supported document questions", () => {
    const semanticMatch = {
      ...makeEvaluatedChunk("doc-1:0", "Khái lược triết học."),
      pineconeScore: 0.72,
      relevanceScore: 0.72,
    };
    const lexicalMatch = {
      ...makeEvaluatedChunk(
        "doc-1:1",
        "Vật chất quyết định ý thức trong hoạt động thực tiễn.",
      ),
      pineconeScore: 0.4,
      relevanceScore: 0.4,
    };

    assert.equal(
      hasSufficientStageOneEvidence("Mác là ai?", [semanticMatch]),
      true,
    );
    assert.equal(
      hasSufficientStageOneEvidence(
        "vật chất quyết định ý thức như thế nào",
        [lexicalMatch],
      ),
      true,
    );
  });

  it("returns a deterministic refusal for out-of-scope questions", async () => {
    const answer = await generateFallbackAnswer({
      question: "xe máy có mấy bánh",
      language: "Vietnamese",
      retrievedChunksCount: 4,
      relevantChunksCount: 0,
      averageRelevanceScore: 0.41,
      reason: "out_of_scope",
    });

    assert.match(answer, /không liên quan/i);
    assert.doesNotMatch(answer, /hai bánh|2 bánh/i);
  });

  it("builds expanded retrieval queries from the user question and static chunk", () => {
    const query = buildExpandedRetrievalQuery(
      "Who is the spouse of the performer?",
      makeEvaluatedChunk(
        "doc-1:0",
        "Green is an album by Steve Hillage.",
        {
          title: "Green",
          sectionTitle: "Album overview",
        },
      ),
    );

    assert.match(query, /Who is the spouse/);
    assert.match(query, /Document: Green/);
    assert.match(query, /Section: Album overview/);
    assert.match(query, /Steve Hillage/);
  });

  it("retrieves dynamic chunks with expanded stage-two queries", async () => {
    const calls: string[] = [];

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
    (
      vectorService as unknown as {
        searchRelevantChunks: typeof vectorService.searchRelevantChunks;
      }
    ).searchRelevantChunks = async (queryOrEmbedding) => {
      const query = Array.isArray(queryOrEmbedding)
        ? queryOrEmbedding.join(" ")
        : queryOrEmbedding;
      calls.push(query);

      if (calls.length === 1) {
        return [
          {
            id: "doc-1:0",
            content:
              "Green is the fourth studio album by Steve Hillage, a British progressive rock performer.",
            pineconeScore: 0.93,
            metadata: {
              documentId: "doc-1",
              userId: "user-1",
              subject: "Music",
              subjectId: "subject-1",
              title: "Green",
              chunkIndex: 0,
              sectionTitle: "Album overview",
            },
          },
        ];
      }

      return [
        {
          id: "doc-2:3",
          content:
            "Miquette Giraudy is a keyboard player and vocalist best known for her work with her partner Steve Hillage.",
          pineconeScore: 0.91,
          metadata: {
            documentId: "doc-2",
            userId: "user-1",
            subject: "Music",
            subjectId: "subject-1",
            title: "Miquette Giraudy",
            chunkIndex: 3,
            sectionTitle: "Biography",
          },
        },
      ];
    };
    (
      groqService as unknown as {
        generateAnswerFromContext: typeof groqService.generateAnswerFromContext;
      }
    ).generateAnswerFromContext = async () => "The spouse/partner is Miquette Giraudy.";
    (
      answerCheckService as unknown as {
        checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
      }
    ).checkAnswerGrounding = async () => ({
      isGrounded: true,
      confidenceScore: 0.9,
      reason: "Grounded",
    });

    const result = await askQuestionWithDrRag("user-1", {
      question: "Who is the spouse of the Green performer?",
    });

    assert.equal(result.mode, "dr-rag");
    assert.equal(result.sources.some((source) => source.documentId === "doc-2"), true);
    assert.equal(result.evaluation.dynamicRetrievalAttempted, true);
    assert.equal(result.evaluation.selectedDynamicChunksCount, 1);
    assert.ok(calls[1].includes("Steve Hillage"));
  });
});
