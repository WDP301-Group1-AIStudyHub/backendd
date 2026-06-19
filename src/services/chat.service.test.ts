import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ChatHistory } from "../models/chatHistory.model";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import * as evaluationService from "./evaluation.service";
import * as ragService from "./rag.service";
import { askQuestion } from "./chat.service";

const originalAskQuestionWithRag = ragService.askQuestionWithRag;
const originalChatHistoryCreate = ChatHistory.create;
const originalCreateEvaluationLog = evaluationService.createEvaluationLog;
const originalStudyDocumentFindOne = StudyDocument.findOne;
const originalDocumentVersionFindOne = DocumentVersion.findOne;

afterEach(() => {
  (
    ragService as unknown as {
      askQuestionWithRag: typeof ragService.askQuestionWithRag;
    }
  ).askQuestionWithRag = originalAskQuestionWithRag;
  ChatHistory.create = originalChatHistoryCreate;
  (
    evaluationService as unknown as {
      createEvaluationLog: typeof evaluationService.createEvaluationLog;
    }
  ).createEvaluationLog = originalCreateEvaluationLog;
  StudyDocument.findOne = originalStudyDocumentFindOne;
  DocumentVersion.findOne = originalDocumentVersionFindOne;
});

describe("chat service persistence controls", () => {
  it("can answer without writing chat history or evaluation logs", async () => {
    let historyCreated = false;
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
    assert.equal(evaluationLogged, false);
  });

  it("persists outline metadata in chat source history", async () => {
    let createdHistory: Record<string, any> | undefined;

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
    (
      evaluationService as unknown as {
        createEvaluationLog: typeof evaluationService.createEvaluationLog;
      }
    ).createEvaluationLog = async () => undefined;

    await askQuestion("user-1", {
      question: "Explain chapter 1",
      mode: "basic",
    });

    assert.equal(
      createdHistory?.sources?.[0]?.outlineNodeId,
      "outline-1-chapter-1",
    );
    assert.equal(createdHistory?.sources?.[0]?.outlinePath, "Part I > Chapter 1");
    assert.equal(createdHistory?.sources?.[0]?.outlineLevel, 2);
    assert.equal(createdHistory?.sources?.[0]?.outlineType, "chapter");
    assert.equal(createdHistory?.sources?.[0]?.chapterOrdinal, "1");
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
      select: async () => ({ subjectId: "subject-1" }),
    })) as unknown as typeof StudyDocument.findOne;
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
      select: async () => ({ subjectId: "subject-1" }),
    })) as unknown as typeof StudyDocument.findOne;

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
      subjectId: "subject-1",
      select: async () => ({ subjectId: "subject-1" }),
    })) as unknown as typeof StudyDocument.findOne;
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
