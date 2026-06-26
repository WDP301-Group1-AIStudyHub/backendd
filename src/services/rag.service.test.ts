import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import * as answerCheckService from "./answerCheck.service";
import * as groqService from "./groq.service";
import * as intentClassifierService from "./intentClassifier.service";
import { askQuestionWithRag } from "./rag.service";
import * as vectorService from "./vector.service";

const originalDocumentFindOne = StudyDocument.findOne;
const originalSubjectFindOne = Subject.findOne;
const originalVersionFindOne = DocumentVersion.findOne;
const originalSearchRelevantChunks = vectorService.searchRelevantChunks;
const originalGenerateAnswerFromContext = groqService.generateAnswerFromContext;
const originalCheckAnswerGrounding = answerCheckService.checkAnswerGrounding;
const originalClassifyQuestionIntent =
  intentClassifierService.classifyQuestionIntent;

afterEach(() => {
  StudyDocument.findOne = originalDocumentFindOne;
  Subject.findOne = originalSubjectFindOne;
  DocumentVersion.findOne = originalVersionFindOne;
  (
    vectorService as unknown as {
      searchRelevantChunks: typeof vectorService.searchRelevantChunks;
    }
  ).searchRelevantChunks = originalSearchRelevantChunks;
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
  (
    intentClassifierService as unknown as {
      classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
    }
  ).classifyQuestionIntent = originalClassifyQuestionIntent;
});

describe("rag service document processing safety", () => {
  it("does not query retrieval when active document version is not indexed", async () => {
    const ownerId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const subjectId = new Types.ObjectId();
    const versionId = new Types.ObjectId();

    StudyDocument.findOne = (() => ({
      _id: documentId,
      ownerId,
      subjectId,
      currentVersionId: versionId,
      title: "Lecture",
      select: async () => ({
        _id: documentId,
        ownerId,
        subjectId,
        currentVersionId: versionId,
        title: "Lecture",
      }),
    })) as unknown as typeof StudyDocument.findOne;
    Subject.findOne = (async () => ({ name: "WDP301" })) as typeof Subject.findOne;
    DocumentVersion.findOne = (() => ({
      select: async () => ({ processingStatus: "PROCESSING" }),
    })) as unknown as typeof DocumentVersion.findOne;

    const result = await askQuestionWithRag(ownerId.toString(), {
      question: "Nội dung là gì?",
      documentId: documentId.toString(),
    });

    assert.equal(
      result.answer,
      "Tài liệu đang được xử lý, vui lòng thử lại sau.",
    );
    assert.equal(result.evaluation?.fallbackReason, "document_processing");
  });

  it("returns evaluated source relevance for basic RAG answers", async () => {
    (
      intentClassifierService as unknown as {
        classifyQuestionIntent: typeof intentClassifierService.classifyQuestionIntent;
      }
    ).classifyQuestionIntent = async () => ({
      intent: "qa",
      confidence: 0.9,
    });
    (
      vectorService as unknown as {
        searchRelevantChunks: typeof vectorService.searchRelevantChunks;
      }
    ).searchRelevantChunks = async () => [
      {
        id: "doc-1:0",
        content: "Retrieval augmented generation answers from document context.",
        pineconeScore: 0.71,
        metadata: {
          documentId: "doc-1",
          userId: "user-1",
          subject: "WDP301",
          subjectId: "subject-1",
          title: "RAG Notes",
          chunkIndex: 0,
        },
      },
    ];
    (
      groqService as unknown as {
        generateAnswerFromContext: typeof groqService.generateAnswerFromContext;
      }
    ).generateAnswerFromContext = async () =>
      "RAG answers should be grounded in document context.";
    (
      answerCheckService as unknown as {
        checkAnswerGrounding: typeof answerCheckService.checkAnswerGrounding;
      }
    ).checkAnswerGrounding = async () => ({
      isGrounded: true,
      confidenceScore: 0.83,
      reason: "Grounded in test context",
    });

    const result = await askQuestionWithRag("user-1", {
      question: "How should RAG answer?",
    });

    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].relevanceScore, 0.71);
    assert.equal(result.evaluation.averageRelevanceScore, 0.71);
    assert.equal(result.evaluation.relevantChunksCount, 1);
  });

});
