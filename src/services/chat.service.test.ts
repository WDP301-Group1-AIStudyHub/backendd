import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ChatHistory } from "../models/chatHistory.model";
import { ChatThread } from "../models/chatThread.model";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import * as evaluationService from "./evaluation.service";
import * as ragService from "./rag.service";
import { askQuestion } from "./chat.service";

const originalAskQuestionWithRag = ragService.askQuestionWithRag;
const originalChatHistoryCreate = ChatHistory.create;
const originalChatThreadCreate = ChatThread.create;
const originalChatThreadFindOne = ChatThread.findOne;
const originalChatThreadFindOneAndUpdate = ChatThread.findOneAndUpdate;
const originalCreateEvaluationLog = evaluationService.createEvaluationLog;
const originalStudyDocumentFindOne = StudyDocument.findOne;
const originalSubjectFindOne = Subject.findOne;
const originalDocumentVersionFindOne = DocumentVersion.findOne;

afterEach(() => {
  (
    ragService as unknown as {
      askQuestionWithRag: typeof ragService.askQuestionWithRag;
    }
  ).askQuestionWithRag = originalAskQuestionWithRag;
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
      ragService as unknown as {
        askQuestionWithRag: typeof ragService.askQuestionWithRag;
      }
    ).askQuestionWithRag = async () => ({
      answer: "Grounded answer",
      mode: "basic",
      originalQuestion: "What is RAG?",
      sources: [],
      evaluation: {
        retrievedChunksCount: 0,
        relevantChunksCount: 0,
        averageRelevanceScore: 0,
        correctiveAttempted: false,
        isGrounded: true,
        confidenceScore: 0.8,
        responseTimeMs: 12,
      },
    });
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
        mode: "basic",
      },
      { persistHistory: false },
    );

    assert.equal(result.answer, "Grounded answer");
    assert.equal(historyCreated, false);
    assert.equal(threadCreated, false);
    assert.equal(evaluationLogged, false);
  });

  it("persists outline metadata in chat source history", async () => {
    let createdHistory: Record<string, any> | undefined;
    let updatedThread: Record<string, any> | undefined;
    const threadId = {
      toString: () => "thread-1",
    };

    (
      ragService as unknown as {
        askQuestionWithRag: typeof ragService.askQuestionWithRag;
      }
    ).askQuestionWithRag = async () => ({
      answer: "Grounded answer",
      mode: "basic",
      originalQuestion: "Explain chapter 1",
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
        retrievedChunksCount: 1,
        relevantChunksCount: 1,
        averageRelevanceScore: 0.91,
        correctiveAttempted: false,
        isGrounded: true,
        confidenceScore: 0.9,
        responseTimeMs: 20,
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
      mode: payload.mode,
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
    ).createEvaluationLog = async () => undefined;

    await askQuestion("user-1", {
      question: "Explain chapter 1",
      mode: "basic",
    });

    assert.equal(createdHistory?.threadId, threadId);
    assert.equal(
      createdHistory?.sources?.[0]?.outlineNodeId,
      "outline-1-chapter-1",
    );
    assert.equal(createdHistory?.sources?.[0]?.outlinePath, "Part I > Chapter 1");
    assert.equal(createdHistory?.sources?.[0]?.outlineLevel, 2);
    assert.equal(createdHistory?.sources?.[0]?.outlineType, "chapter");
    assert.equal(createdHistory?.sources?.[0]?.chapterOrdinal, "1");
    assert.deepEqual(updatedThread?.$inc, { messageCount: 1 });
    assert.equal(updatedThread?.$set?.scope, "library_all");
  });

  it("appends new questions to an existing chat thread", async () => {
    let createdHistory: Record<string, any> | undefined;
    let newThreadCreated = false;
    const threadId = {
      toString: () => "thread-existing",
    };

    (
      ragService as unknown as {
        askQuestionWithRag: typeof ragService.askQuestionWithRag;
      }
    ).askQuestionWithRag = async () => ({
      answer: "Follow-up answer",
      mode: "basic",
      originalQuestion: "Continue",
      sources: [],
      evaluation: {
        retrievedChunksCount: 0,
        relevantChunksCount: 0,
        averageRelevanceScore: 0,
        correctiveAttempted: false,
        isGrounded: true,
        confidenceScore: 0.8,
        responseTimeMs: 15,
      },
    });
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
      mode: "basic",
      threadId: "thread-existing",
    });

    assert.equal(result.threadId, "thread-existing");
    assert.equal(newThreadCreated, false);
    assert.equal(createdHistory?.threadId, threadId);
  });

  it("answers document structure count questions without calling RAG retrieval", async () => {
    let ragCalled = false;

    StudyDocument.findOne = ((filter: Record<string, unknown>) => ({
      _id: filter._id || "doc-1",
      subjectId: "subject-1",
      title: "Structured document",
      extractedText: `
Chương 1 Tổng quan
Nội dung chương một.

Chương 2 Phương pháp
Nội dung chương hai.
`,
      currentVersionId: undefined,
      select: async () => ({
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
      }),
    })) as unknown as typeof StudyDocument.findOne;
    Subject.findOne = (async () => ({ name: "WDP301" })) as typeof Subject.findOne;
    (
      ragService as unknown as {
        askQuestionWithRag: typeof ragService.askQuestionWithRag;
      }
    ).askQuestionWithRag = async () => {
      ragCalled = true;
      throw new Error("RAG should not be called");
    };

    const result = await askQuestion(
      "user-1",
      {
        question: "Tài liệu này có mấy chương?",
        documentId: "doc-1",
        mode: "basic",
      },
      { persistHistory: false },
    );

    assert.equal(ragCalled, false);
    assert.match(result.answer, /Tài liệu này có 2 chương/);
    assert.match(result.answer, /Chương 1 Tổng quan/);
    assert.equal(result.evaluation?.detectedIntent, "document_structure");
    assert.equal(result.evaluation?.fallbackGenerated, false);
  });

  it("returns deterministic fallback when structure is not detected", async () => {
    StudyDocument.findOne = ((filter: Record<string, unknown>) => ({
      _id: filter._id || "doc-1",
      subjectId: "subject-1",
      title: "Plain document",
      extractedText: "Đây là tài liệu dạng văn bản không có heading rõ ràng.",
      currentVersionId: undefined,
      select: async () => ({
        _id: filter._id || "doc-1",
        subjectId: "subject-1",
        title: "Plain document",
        extractedText: "ÄÃ¢y lÃ  tÃ i liá»‡u dáº¡ng vÄƒn báº£n khÃ´ng cÃ³ heading rÃµ rÃ ng.",
        currentVersionId: undefined,
      }),
    })) as unknown as typeof StudyDocument.findOne;
    Subject.findOne = (async () => ({ name: "WDP301" })) as typeof Subject.findOne;

    const result = await askQuestion(
      "user-1",
      {
        question: "Tài liệu này có mấy chương?",
        documentId: "doc-1",
      },
      { persistHistory: false },
    );

    assert.equal(
      result.answer,
      "Không tìm thấy thông tin về số chương trong tài liệu này. Có thể tài liệu chưa chứa thông tin này hoặc câu hỏi quá chung chung. Bạn có thể thử hỏi cụ thể hơn về nội dung của tài liệu hoặc kiểm tra lại tài liệu để đảm bảo thông tin cần thiết đã được cập nhật.",
    );
    assert.equal(result.evaluation?.fallbackGenerated, true);
    assert.equal(result.evaluation?.fallbackReason, "document_structure_not_found");
  });

  it("keeps specific chapter content questions on the normal RAG path", async () => {
    let ragCalled = false;

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
      ragService as unknown as {
        askQuestionWithRag: typeof ragService.askQuestionWithRag;
      }
    ).askQuestionWithRag = async () => {
      ragCalled = true;
      return {
        answer: "Chapter content answer",
        mode: "basic",
        originalQuestion: "Nội dung chương 2 là gì?",
        sources: [],
        evaluation: {
          retrievedChunksCount: 1,
          relevantChunksCount: 1,
          averageRelevanceScore: 0.8,
          correctiveAttempted: false,
          isGrounded: true,
          confidenceScore: 0.9,
          responseTimeMs: 10,
        },
      };
    };

    const result = await askQuestion(
      "user-1",
      {
        question: "Nội dung chương 2 là gì?",
        documentId: "doc-1",
      },
      { persistHistory: false },
    );

    assert.equal(ragCalled, true);
    assert.equal(result.answer, "Chapter content answer");
  });
});
