import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { askQuestionWithRag } from "./rag.service";

const originalDocumentFindOne = StudyDocument.findOne;
const originalSubjectFindOne = Subject.findOne;
const originalVersionFindOne = DocumentVersion.findOne;

afterEach(() => {
  StudyDocument.findOne = originalDocumentFindOne;
  Subject.findOne = originalSubjectFindOne;
  DocumentVersion.findOne = originalVersionFindOne;
});

describe("rag service document processing safety", () => {
  it("does not query retrieval when active document version is not indexed", async () => {
    const ownerId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const subjectId = new Types.ObjectId();
    const versionId = new Types.ObjectId();

    StudyDocument.findOne = (async () => ({
      _id: documentId,
      ownerId,
      subjectId,
      currentVersionId: versionId,
      title: "Lecture",
    })) as typeof StudyDocument.findOne;
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
});
