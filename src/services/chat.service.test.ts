import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ChatHistory } from "../models/chatHistory.model";
import { ChatThread } from "../models/chatThread.model";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import * as evaluationService from "./evaluation.service";
import * as drRagService from "./drRag.service";
import { askQuestion } from "./chat.service";

const originalAskQuestionWithDrRag = drRagService.askQuestionWithDrRag;
const originalChatHistoryCreate = ChatHistory.create;
const originalChatThreadCreate = ChatThread.create;
const originalChatThreadFindOne = ChatThread.findOne;
const originalChatThreadFindOneAndUpdate = ChatThread.findOneAndUpdate;
const originalCreateEvaluationLog = evaluationService.createEvaluationLog;
const originalStudyDocumentFindOne = StudyDocument.findOne;
const originalSubjectFindOne = Subject.findOne;
const originalDocumentVersionFindOne = DocumentVersion.findOne;

const makeDrRagResult = (question: string) => ({
  answer: "Grounded answer",
  mode: "dr-rag" as const,
  originalQuestion: question,
  rewrittenQuery: question,
  sources: [],
  evaluation: {
    retrievedChunksCount: 0,
    relevantChunksCount: 0,
    averageRelevanceScore: 0,
    isGrounded: true,
    confidenceScore: 0.8,
    responseTimeMs: 12,
    stageOneChunksCount: 0,
    stageTwoChunksCount: 0,
    selectedStaticChunksCount: 0,
    selectedDynamicChunksCount: 0,
    dynamicRetrievalAttempted: false,
    selectionStrategy: "cfs-heuristic" as const,
    retrievalQueries: [question],
  },
});

afterEach(() => {
  (
    drRagService as unknown as {
      askQuestionWithDrRag: typeof drRagService.askQuestionWithDrRag;
    }
  ).askQuestionWithDrRag = originalAskQuestionWithDrRag;
  ChatHistory.create = originalChatHistoryCreate;
  ChatThread.create = originalChatThreadCreate;
  ChatThread.findOne = originalChatThreadFindOne;
  ChatThread.findOneAndUpdate = originalChatThreadFindOneAndUpdate;
  (
    evaluationService as unknown as {
      createEvaluationLog: typeof evaluationService.createEvaluationLog;
    }
  ).createEvaluationLog = originalCreateEvaluationLog;
  StudyDocument.findOne = originalStudyDocumentFindOne;
  Subject.findOne = originalSubjectFindOne;
  DocumentVersion.findOne = originalDocumentVersionFindOne;
});

describe("chat service persistence controls", () => {
  it("can answer without writing chat history or evaluation logs", async () => {
    let historyCreated = false;
    let threadCreated = false;
    let evaluationLogged = false;

    (
      drRagService as unknown as {
        askQuestionWithDrRag: typeof drRagService.askQuestionWithDrRag;
      }
    ).askQuestionWithDrRag = async () => makeDrRagResult("What is RAG?");
    ChatHistory.create = (async () => {
      historyCreated = true;
      return {};
    }) as typeof ChatHistory.create;
    ChatThread.create = (async () => {
      threadCreated = true;
      return {};
    }) as typeof ChatThread.create;
    (
      evaluationService as unknown as {
        createEvaluationLog: typeof evaluationService.createEvaluationLog;
      }
    ).createEvaluationLog = async () => {
      evaluationLogged = true;
    };

    const result = await askQuestion(
      "user-1",
      {
        question: "What is RAG?",
      },
      { persistHistory: false },
    );

    assert.equal(result.answer, "Grounded answer");
    assert.equal(historyCreated, false);
    assert.equal(threadCreated, false);
    assert.equal(evaluationLogged, false);
  });

  it("persists outline metadata and DR-RAG metrics in chat source history", async () => {
    let createdHistory: Record<string, any> | undefined;
    let createdLog: Record<string, any> | undefined;
    let updatedThread: Record<string, any> | undefined;
    const threadId = {
      toString: () => "thread-1",
    };

    (
      drRagService as unknown as {
        askQuestionWithDrRag: typeof drRagService.askQuestionWithDrRag;
      }
    ).askQuestionWithDrRag = async () => ({
      ...makeDrRagResult("Explain chapter 1"),
      sources: [
        {
          documentId: "doc-1",
          title: "Document",
          chunkIndex: 0,
          contentPreview: "Chapter context",
          outlineNodeId: "outline-1-chapter-1",
          outlinePath: "Part I > Chapter 1",
          outlineLevel: 2,
          outlineType: "chapter",
          chapterOrdinal: "1",
          relevanceScore: 0.91,
        },
      ],
      evaluation: {
        ...makeDrRagResult("Explain chapter 1").evaluation,
        retrievedChunksCount: 2,
        relevantChunksCount: 2,
        averageRelevanceScore: 0.91,
        stageOneChunksCount: 1,
        stageTwoChunksCount: 1,
        selectedStaticChunksCount: 1,
        selectedDynamicChunksCount: 1,
        dynamicRetrievalAttempted: true,
      },
    });
    ChatHistory.create = (async (payload: Record<string, any>) => {
      createdHistory = payload;
      return payload;
    }) as typeof ChatHistory.create;
    ChatThread.create = (async (payload: Record<string, any>) => ({
      _id: threadId,
      ownerId: payload.ownerId,
      title: payload.title,
      status: payload.status,
      lastMessageAt: payload.lastMessageAt,
      messageCount: payload.messageCount,
      scope: payload.scope,
      subjectId: payload.subjectId,
      documentId: payload.documentId,
      documentIds: payload.documentIds,
      mode: "dr-rag",
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as typeof ChatThread.create;
    ChatThread.findOneAndUpdate = (async (
      _filter: Record<string, any>,
      update: Record<string, any>,
    ) => {
      updatedThread = update;
      return {};
    }) as typeof ChatThread.findOneAndUpdate;
    (
      evaluationService as unknown as {
        createEvaluationLog: typeof evaluationService.createEvaluationLog;
      }
    ).createEvaluationLog = async (payload) => {
      createdLog = payload as Record<string, any>;
    };

    await askQuestion("user-1", {
      question: "Explain chapter 1",
    });

    assert.equal(createdHistory?.threadId, threadId);
    assert.equal(createdHistory?.mode, "dr-rag");
    assert.equal(
      createdHistory?.sources?.[0]?.outlineNodeId,
      "outline-1-chapter-1",
    );
    assert.deepEqual(updatedThread?.$inc, { messageCount: 1 });
    assert.equal(updatedThread?.$set?.scope, "library_all");
    assert.equal(updatedThread?.$set?.mode, "dr-rag");
    assert.equal(createdLog?.retrievalMode, "dr-rag");
    assert.equal(createdLog?.stageOneChunksCount, 1);
    assert.equal(createdLog?.stageTwoChunksCount, 1);
    assert.equal(createdLog?.selectedDynamicChunksCount, 1);
  });

  it("appends new questions to an existing chat thread", async () => {
    let createdHistory: Record<string, any> | undefined;
    let newThreadCreated = false;
    const threadId = {
      toString: () => "thread-existing",
    };

    (
      drRagService as unknown as {
        askQuestionWithDrRag: typeof drRagService.askQuestionWithDrRag;
      }
    ).askQuestionWithDrRag = async () => makeDrRagResult("Continue");
    ChatThread.findOne = (async () => ({
      _id: threadId,
      ownerId: "user-1",
      title: "Existing thread",
      status: "ACTIVE",
      lastMessageAt: new Date(),
      messageCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as typeof ChatThread.findOne;
    ChatThread.create = (async () => {
      newThreadCreated = true;
      return {};
    }) as typeof ChatThread.create;
    ChatThread.findOneAndUpdate = (async () => ({})) as typeof ChatThread.findOneAndUpdate;
    ChatHistory.create = (async (payload: Record<string, any>) => {
      createdHistory = payload;
      return payload;
    }) as typeof ChatHistory.create;
    (
      evaluationService as unknown as {
        createEvaluationLog: typeof evaluationService.createEvaluationLog;
      }
    ).createEvaluationLog = async () => undefined;

    const result = await askQuestion("user-1", {
      question: "Continue",
      threadId: "thread-existing",
    });

    assert.equal(result.threadId, "thread-existing");
    assert.equal(newThreadCreated, false);
    assert.equal(createdHistory?.threadId, threadId);
  });

  it("answers document structure count questions without calling DR-RAG retrieval", async () => {
    let drRagCalled = false;

    StudyDocument.findOne = ((filter: Record<string, unknown>) => ({
      _id: filter._id || "doc-1",
      subjectId: "subject-1",
      title: "Structured document",
      extractedText: `
ChÆ°Æ¡ng 1 Tá»•ng quan
Ná»™i dung chÆ°Æ¡ng má»™t.

ChÆ°Æ¡ng 2 PhÆ°Æ¡ng phÃ¡p
Ná»™i dung chÆ°Æ¡ng hai.
`,
      currentVersionId: undefined,
      select: async () => ({
        _id: filter._id || "doc-1",
        subjectId: "subject-1",
        title: "Structured document",
        extractedText: `
ChÃ†Â°Ã†Â¡ng 1 TÃ¡Â»â€¢ng quan
NÃ¡Â»â„¢i dung chÃ†Â°Ã†Â¡ng mÃ¡Â»â„¢t.

ChÃ†Â°Ã†Â¡ng 2 PhÃ†Â°Ã†Â¡ng phÃƒÂ¡p
NÃ¡Â»â„¢i dung chÃ†Â°Ã†Â¡ng hai.
`,
        currentVersionId: undefined,
      }),
    })) as unknown as typeof StudyDocument.findOne;
    Subject.findOne = (async () => ({ name: "WDP301" })) as typeof Subject.findOne;
    (
      drRagService as unknown as {
        askQuestionWithDrRag: typeof drRagService.askQuestionWithDrRag;
      }
    ).askQuestionWithDrRag = async () => {
      drRagCalled = true;
      throw new Error("DR-RAG should not be called");
    };

    const result = await askQuestion(
      "user-1",
      {
        question: "tai lieu nay co may chuong?",
        documentId: "doc-1",
      },
      { persistHistory: false },
    );

    assert.equal(drRagCalled, false);
    assert.match(result.answer, /2/);
    assert.match(result.answer, /1 .*quan/i);
    assert.equal(result.mode, "dr-rag");
    assert.equal(result.evaluation?.detectedIntent, "document_structure");
    assert.equal(result.evaluation?.fallbackGenerated, false);
  });

  it("keeps specific chapter content questions on the DR-RAG path", async () => {
    let drRagCalled = false;

    StudyDocument.findOne = (() => ({
      _id: "doc-1",
      subjectId: "subject-1",
      title: "Document",
      currentVersionId: undefined,
      select: async () => ({
        _id: "doc-1",
        subjectId: "subject-1",
        title: "Document",
        currentVersionId: undefined,
      }),
    })) as unknown as typeof StudyDocument.findOne;
    Subject.findOne = (async () => ({ name: "WDP301" })) as typeof Subject.findOne;
    (
      drRagService as unknown as {
        askQuestionWithDrRag: typeof drRagService.askQuestionWithDrRag;
      }
    ).askQuestionWithDrRag = async () => {
      drRagCalled = true;
      return {
        ...makeDrRagResult("Ná»™i dung chÆ°Æ¡ng 2 lÃ  gÃ¬?"),
        answer: "Chapter content answer",
      };
    };

    const result = await askQuestion(
      "user-1",
      {
        question: "Ná»™i dung chÆ°Æ¡ng 2 lÃ  gÃ¬?",
        documentId: "doc-1",
      },
      { persistHistory: false },
    );

    assert.equal(drRagCalled, true);
    assert.equal(result.answer, "Chapter content answer");
  });
});
