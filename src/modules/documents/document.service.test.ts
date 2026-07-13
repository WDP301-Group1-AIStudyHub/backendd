import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { Subject } from "../subjects/subject.model";
import { StudyDocument } from "./document.model";
import { DocumentShare } from "../documentShares/documentShare.model";
import { DocumentShareInvitation } from "../documentShares/documentShareInvitation.model";
import { DocumentStar } from "../documentStars/documentStar.model";
import { DocumentVersion } from "../documentVersions/documentVersion.model";
import { UploadSession } from "../uploadSessions/uploadSession.model";
import * as cloudinaryService from "../../services/cloudinary.service";
import * as vectorService from "../../services/vector.service";
import { StudyMaterial } from "../../models/studyMaterial.model";
import { ChatHistory } from "../../models/chatHistory.model";
import { ChatThread } from "../../models/chatThread.model";
import { BenchmarkQuestion } from "../../models/benchmarkQuestion.model";
import {
  createDocumentMetadata,
  emptyTrashDocuments,
  getDocuments,
  permanentlyDeleteDocumentRecord,
  restoreDocumentFromTrash,
  setDocumentStar,
  softDeleteDocument,
  toDocumentResponse,
  updateDocumentMetadata,
} from "./document.service";

const originalSubjectFindOne = Subject.findOne;
const originalDocumentCreate = StudyDocument.create;
const originalDocumentFind = StudyDocument.find;
const originalDocumentCountDocuments = StudyDocument.countDocuments;
const originalDocumentFindOneAndUpdate = StudyDocument.findOneAndUpdate;
const originalDocumentFindOne = StudyDocument.findOne;
const originalDocumentFindById = StudyDocument.findById;
const originalDocumentDeleteOne = StudyDocument.deleteOne;
const originalDocumentUpdateOne = StudyDocument.updateOne;
const originalShareDistinct = DocumentShare.distinct;
const originalShareFindOne = DocumentShare.findOne;
const originalShareDeleteMany = DocumentShare.deleteMany;
const originalInvitationDeleteMany = DocumentShareInvitation.deleteMany;
const originalStarFind = DocumentStar.find;
const originalStarFindOneAndUpdate = DocumentStar.findOneAndUpdate;
const originalStarDeleteOne = DocumentStar.deleteOne;
const originalStarDeleteMany = DocumentStar.deleteMany;
const originalVersionFind = DocumentVersion.find;
const originalVersionDeleteMany = DocumentVersion.deleteMany;
const originalVersionUpdateMany = DocumentVersion.updateMany;
const originalSessionDeleteMany = UploadSession.deleteMany;
const originalDeleteCloudinaryFile = cloudinaryService.deleteCloudinaryFile;
const originalDeleteDocumentChunks = vectorService.deleteDocumentChunks;
const originalStudyMaterialUpdateMany = StudyMaterial.updateMany;
const originalChatHistoryUpdateMany = ChatHistory.updateMany;
const originalChatThreadUpdateMany = ChatThread.updateMany;
const originalBenchmarkQuestionUpdateMany = BenchmarkQuestion.updateMany;

afterEach(() => {
  Subject.findOne = originalSubjectFindOne;
  StudyDocument.create = originalDocumentCreate;
  StudyDocument.find = originalDocumentFind;
  StudyDocument.countDocuments = originalDocumentCountDocuments;
  StudyDocument.findOneAndUpdate = originalDocumentFindOneAndUpdate;
  StudyDocument.findOne = originalDocumentFindOne;
  StudyDocument.findById = originalDocumentFindById;
  StudyDocument.deleteOne = originalDocumentDeleteOne;
  StudyDocument.updateOne = originalDocumentUpdateOne;
  DocumentShare.distinct = originalShareDistinct;
  DocumentShare.findOne = originalShareFindOne;
  DocumentShare.deleteMany = originalShareDeleteMany;
  DocumentShareInvitation.deleteMany = originalInvitationDeleteMany;
  DocumentStar.find = originalStarFind;
  DocumentStar.findOneAndUpdate = originalStarFindOneAndUpdate;
  DocumentStar.deleteOne = originalStarDeleteOne;
  DocumentStar.deleteMany = originalStarDeleteMany;
  DocumentVersion.find = originalVersionFind;
  DocumentVersion.deleteMany = originalVersionDeleteMany;
  DocumentVersion.updateMany = originalVersionUpdateMany;
  UploadSession.deleteMany = originalSessionDeleteMany;
  StudyMaterial.updateMany = originalStudyMaterialUpdateMany;
  ChatHistory.updateMany = originalChatHistoryUpdateMany;
  ChatThread.updateMany = originalChatThreadUpdateMany;
  BenchmarkQuestion.updateMany = originalBenchmarkQuestionUpdateMany;
  (
    cloudinaryService as typeof cloudinaryService & {
      deleteCloudinaryFile: typeof cloudinaryService.deleteCloudinaryFile;
    }
  ).deleteCloudinaryFile = originalDeleteCloudinaryFile;
  (
    vectorService as typeof vectorService & {
      deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
    }
  ).deleteDocumentChunks = originalDeleteDocumentChunks;
});

const ownerId = new Types.ObjectId();
const subjectId = new Types.ObjectId();

const fakeSubject = {
  _id: subjectId,
  ownerId,
  name: "PRM392",
  description: "Mobile Programming",
  color: "#2563eb",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const fakeDocument = {
  _id: new Types.ObjectId(),
  ownerId,
  subjectId: fakeSubject,
  title: "React Hooks",
  description: "Week 3",
  visibility: "PRIVATE",
  status: "ACTIVE",
  totalViews: 0,
  totalDownloads: 0,
  deletedAt: null,
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  populate: async () => undefined,
};

describe("document service", () => {
  it("preserves the workspace subject for shared documents without a personal subject override", () => {
    const result = toDocumentResponse(fakeDocument as never, {
      accessRole: "VIEWER",
      isShared: true,
    });

    assert.equal(result.subject?._id, subjectId.toString());
    assert.equal(result.subject?.name, "PRM392");
    assert.equal(
      (result.subjectId as unknown as { _id: string })._id,
      subjectId.toString(),
    );
    assert.equal(result.personalSubject, undefined);
  });

  it("creates document metadata for an owned subject", async () => {
    let createPayload: unknown;

    Subject.findOne = (async (filter: unknown) => {
      assert.deepEqual(filter, {
        _id: subjectId.toString(),
        ownerId: ownerId.toString(),
      });
      return fakeSubject;
    }) as typeof Subject.findOne;
    StudyDocument.create = (async (payload: unknown) => {
      createPayload = payload;
      return fakeDocument;
    }) as typeof StudyDocument.create;

    const result = await createDocumentMetadata(ownerId.toString(), {
      title: "React Hooks",
      description: "Week 3",
      subjectId: subjectId.toString(),
    });

    assert.equal(result.title, "React Hooks");
    assert.equal(result.visibility, "PRIVATE");
    assert.deepEqual(createPayload, {
      ownerId: ownerId.toString(),
      subjectId,
      title: "React Hooks",
      description: "Week 3",
      visibility: "PRIVATE",
      status: "ACTIVE",
    });
  });

  it("lists readable documents with pagination, subject filter, and keyword search", async () => {
    let capturedFilter: Record<string, unknown> | undefined;
    let capturedSkip = 0;
    let capturedLimit = 0;

    StudyDocument.find = ((filter: Record<string, unknown>) => {
      capturedFilter = filter;
      const query = {
        select: () => query,
        populate: () => query,
        sort: () => query,
        skip: (skip: number) => {
          capturedSkip = skip;
          return query;
        },
        limit: (limit: number) => {
          capturedLimit = limit;
          return Promise.resolve([fakeDocument]);
        },
      };

      return {
        select: query.select,
      };
    }) as unknown as typeof StudyDocument.find;
    StudyDocument.countDocuments = (async () => 21) as typeof StudyDocument.countDocuments;
    DocumentShare.distinct = (async () => []) as unknown as typeof DocumentShare.distinct;
    DocumentStar.find = (() => ({
      select: async () => [],
    })) as unknown as typeof DocumentStar.find;

    const result = await getDocuments(ownerId.toString(), "user", {
      page: "2",
      limit: "10",
      subjectId: subjectId.toString(),
      keyword: "react",
      visibility: "PUBLIC",
    });

    assert.equal(result.data.length, 1);
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.limit, 10);
    assert.equal(result.pagination.totalItems, 21);
    assert.equal(result.pagination.totalPages, 3);
    assert.equal(capturedSkip, 10);
    assert.equal(capturedLimit, 10);
    assert.deepEqual(capturedFilter?.$or, [
      { ownerId: ownerId.toString(), subjectId: subjectId.toString() },
      { _id: { $in: [] } },
    ]);
    assert.equal(capturedFilter?.visibility, "PUBLIC");
    assert.ok(capturedFilter?.$and);
  });

  it("soft deletes documents instead of removing them", async () => {
    let updatePayload: Record<string, unknown> | undefined;

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    StudyDocument.findOneAndUpdate = (async (
      _filter: unknown,
      payload: Record<string, unknown>,
    ) => {
      updatePayload = payload;
      return fakeDocument;
    }) as typeof StudyDocument.findOneAndUpdate;
    StudyDocument.updateOne = (async () => ({ acknowledged: true, modifiedCount: 1 })) as unknown as typeof StudyDocument.updateOne;
    DocumentVersion.updateMany = (async () => ({ acknowledged: true, modifiedCount: 1 })) as unknown as typeof DocumentVersion.updateMany;
    (
      vectorService as typeof vectorService & {
        deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
      }
    ).deleteDocumentChunks = async () => ({ deletedVectorCount: 3 });

    const result = await softDeleteDocument(fakeDocument._id.toString(), ownerId.toString());

    assert.equal(updatePayload?.status, "DELETED");
    assert.ok(updatePayload?.deletedAt instanceof Date);
    assert.equal(updatePayload?.ragStatus, "DELETE_PENDING");
    assert.equal(result.ragStatus, "DELETED");
  });

  it("restores a document without extracted text as active but not AI-indexable", async () => {
    const deletedDocument = {
      ...fakeDocument,
      status: "DELETED",
      deletedAt: new Date("2026-02-01T00:00:00.000Z"),
      deletedBy: ownerId,
      extractedText: "",
    };
    const restoredDocument = {
      ...deletedDocument,
      status: "ACTIVE",
      deletedAt: null,
      deletedBy: null,
      ragStatus: "NOT_AVAILABLE",
    };
    const updates: Array<Record<string, any>> = [];

    StudyDocument.findOne = (async () => deletedDocument) as typeof StudyDocument.findOne;
    StudyDocument.findOneAndUpdate = (async () => restoredDocument) as typeof StudyDocument.findOneAndUpdate;
    StudyDocument.updateOne = (async (_filter: unknown, update: Record<string, any>) => {
      updates.push(update);
      return { acknowledged: true, modifiedCount: 1 };
    }) as unknown as typeof StudyDocument.updateOne;
    StudyDocument.findById = (() => {
      const query = {
        populate: () => query,
        then: (resolve: (value: typeof restoredDocument) => unknown) =>
          Promise.resolve(restoredDocument).then(resolve),
      };
      return query;
    }) as unknown as typeof StudyDocument.findById;
    DocumentStar.find = (() => ({ select: async () => [] })) as unknown as typeof DocumentStar.find;
    (
      vectorService as typeof vectorService & {
        deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
      }
    ).deleteDocumentChunks = async () => ({ deletedVectorCount: 2 });

    const result = await restoreDocumentFromTrash(
      fakeDocument._id.toString(),
      ownerId.toString(),
    );

    assert.equal(result.status, "ACTIVE");
    assert.equal(result.ragStatus, "NOT_AVAILABLE");
    assert.equal(updates[0].$set.ragStatus, "NOT_AVAILABLE");
    assert.equal(updates[0].$set.totalChunks, 0);
  });

  it("allows shared editors to update title and description", async () => {
    const editorId = new Types.ObjectId();
    let updatePayload: Record<string, unknown> | undefined;
    const updatedDocument = {
      ...fakeDocument,
      title: "React Hooks Updated",
      description: "Week 4",
    };

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    DocumentShare.findOne = (() => ({
      select: async () => ({ permission: "EDIT" }),
    })) as unknown as typeof DocumentShare.findOne;
    DocumentStar.find = (() => ({
      select: async () => [],
    })) as unknown as typeof DocumentStar.find;
    StudyDocument.findOneAndUpdate = ((
      _filter: unknown,
      payload: Record<string, unknown>,
    ) => {
      updatePayload = payload;
      return {
        populate: async () => updatedDocument,
      };
    }) as unknown as typeof StudyDocument.findOneAndUpdate;

    const result = await updateDocumentMetadata(
      fakeDocument._id.toString(),
      editorId.toString(),
      "user",
      {
        title: "React Hooks Updated",
        description: "Week 4",
      },
    );

    assert.equal(result.accessRole, "EDITOR");
    assert.equal(result.title, "React Hooks Updated");
    assert.deepEqual(updatePayload, {
      title: "React Hooks Updated",
      description: "Week 4",
    });
  });

  it("blocks shared editors from updating owner-only document metadata", async () => {
    const editorId = new Types.ObjectId();
    let updateCalls = 0;

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    DocumentShare.findOne = (() => ({
      select: async () => ({ permission: "EDIT" }),
    })) as unknown as typeof DocumentShare.findOne;
    StudyDocument.findOneAndUpdate = (() => {
      updateCalls += 1;
      throw new Error("findOneAndUpdate should not be called");
    }) as unknown as typeof StudyDocument.findOneAndUpdate;

    for (const payload of [
      { subjectId: subjectId.toString() },
      { visibility: "PUBLIC" as const },
      { status: "ARCHIVED" as const },
    ]) {
      await assert.rejects(
        () =>
          updateDocumentMetadata(
            fakeDocument._id.toString(),
            editorId.toString(),
            "user",
            payload,
          ),
        /Only the document owner can update document organization and visibility/,
      );
    }

    assert.equal(updateCalls, 0);
  });

  it("lets readable users star a document without changing document ownership", async () => {
    let starPayload: Record<string, unknown> | undefined;
    const starredAt = new Date("2026-02-01T00:00:00.000Z");

    StudyDocument.findOne = (async () => fakeDocument) as typeof StudyDocument.findOne;
    DocumentStar.findOneAndUpdate = (async (
      _filter: unknown,
      payload: Record<string, unknown>,
    ) => {
      starPayload = payload;
      return { _id: new Types.ObjectId() };
    }) as unknown as typeof DocumentStar.findOneAndUpdate;
    DocumentStar.find = (() => ({
      select: async () => [
        {
          documentId: fakeDocument._id,
          createdAt: starredAt,
        },
      ],
    })) as unknown as typeof DocumentStar.find;

    const result = await setDocumentStar(
      fakeDocument._id.toString(),
      ownerId.toString(),
      "user",
      true,
    );

    assert.equal(result.isStarred, true);
    assert.equal(result.starredAt?.toISOString(), starredAt.toISOString());
    assert.equal(result.accessRole, "OWNER");
    assert.equal(
      (starPayload?.$setOnInsert as Record<string, unknown>)?.documentId,
      fakeDocument._id,
    );
  });

  it("permanently deletes files, vectors, versions, shares, invitations, stars and document record", async () => {
    const versionPublicId = "ai-study-hub/documents/version-2.pdf";
    const deletedCloudinaryIds: string[] = [];
    const deletedCollections: string[] = [];
    let deletedVectorDocumentId: string | undefined;
    let studyMaterialUpdate: Record<string, any> | undefined;
    let chatHistoryUpdate: Record<string, any> | undefined;

    DocumentVersion.find = (() => ({
      select: async () => [{ filePublicId: versionPublicId }],
    })) as unknown as typeof DocumentVersion.find;
    DocumentVersion.deleteMany = (async () => {
      deletedCollections.push("versions");
      return { acknowledged: true, deletedCount: 2 };
    }) as unknown as typeof DocumentVersion.deleteMany;
    UploadSession.deleteMany = (async () => {
      deletedCollections.push("sessions");
      return { acknowledged: true, deletedCount: 1 };
    }) as unknown as typeof UploadSession.deleteMany;
    DocumentShare.deleteMany = (async () => {
      deletedCollections.push("shares");
      return { acknowledged: true, deletedCount: 1 };
    }) as unknown as typeof DocumentShare.deleteMany;
    DocumentShareInvitation.deleteMany = (async () => {
      deletedCollections.push("invitations");
      return { acknowledged: true, deletedCount: 1 };
    }) as unknown as typeof DocumentShareInvitation.deleteMany;
    DocumentStar.deleteMany = (async () => {
      deletedCollections.push("stars");
      return { acknowledged: true, deletedCount: 1 };
    }) as unknown as typeof DocumentStar.deleteMany;
    StudyMaterial.updateMany = (async (_filter: unknown, payload: Record<string, any>) => {
      studyMaterialUpdate = payload;
      return { acknowledged: true, modifiedCount: 1 };
    }) as unknown as typeof StudyMaterial.updateMany;
    ChatHistory.updateMany = (async (_filter: unknown, payload: Record<string, any>) => {
      chatHistoryUpdate = payload;
      return { acknowledged: true, modifiedCount: 1 };
    }) as unknown as typeof ChatHistory.updateMany;
    ChatThread.updateMany = (async () => ({ acknowledged: true, modifiedCount: 1 })) as unknown as typeof ChatThread.updateMany;
    BenchmarkQuestion.updateMany = (async () => ({ acknowledged: true, modifiedCount: 1 })) as unknown as typeof BenchmarkQuestion.updateMany;
    StudyDocument.deleteOne = (async () => {
      deletedCollections.push("document");
      return { acknowledged: true, deletedCount: 1 };
    }) as unknown as typeof StudyDocument.deleteOne;
    (
      cloudinaryService as typeof cloudinaryService & {
        deleteCloudinaryFile: typeof cloudinaryService.deleteCloudinaryFile;
      }
    ).deleteCloudinaryFile = async (publicId: string) => {
      deletedCloudinaryIds.push(publicId);
    };
    (
      vectorService as typeof vectorService & {
        deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
      }
    ).deleteDocumentChunks = async (documentId: string) => {
      deletedVectorDocumentId = documentId;
      return { deletedVectorCount: 3 };
    };

    await permanentlyDeleteDocumentRecord({
      ...fakeDocument,
      filePublicId: "ai-study-hub/documents/current.pdf",
    } as any);

    assert.deepEqual(deletedCloudinaryIds.sort(), [
      "ai-study-hub/documents/current.pdf",
      versionPublicId,
    ].sort());
    assert.equal(deletedVectorDocumentId, fakeDocument._id.toString());
    assert.equal(studyMaterialUpdate?.$set?.documentId, null);
    assert.equal(studyMaterialUpdate?.$set?.sourceStatus, "DELETED");
    assert.equal(chatHistoryUpdate?.$set?.sourceStatus, "DELETED");
    assert.equal(chatHistoryUpdate?.$unset?.sources, undefined);
    assert.deepEqual(deletedCollections.sort(), [
      "document",
      "invitations",
      "sessions",
      "shares",
      "stars",
      "versions",
    ].sort());
  });

  it("does not delete Cloudinary or Mongo records when Pinecone cleanup fails", async () => {
    let cloudinaryCalled = false;
    let mongoDeleteCalled = false;
    DocumentVersion.find = (() => ({ select: async () => [] })) as unknown as typeof DocumentVersion.find;
    StudyDocument.deleteOne = (async () => {
      mongoDeleteCalled = true;
      return { acknowledged: true, deletedCount: 1 };
    }) as unknown as typeof StudyDocument.deleteOne;
    (
      vectorService as typeof vectorService & {
        deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
      }
    ).deleteDocumentChunks = async () => {
      throw new Error("Pinecone unavailable");
    };
    (
      cloudinaryService as typeof cloudinaryService & {
        deleteCloudinaryFile: typeof cloudinaryService.deleteCloudinaryFile;
      }
    ).deleteCloudinaryFile = async () => {
      cloudinaryCalled = true;
    };

    await assert.rejects(
      () => permanentlyDeleteDocumentRecord(fakeDocument as any),
      /Pinecone unavailable/,
    );
    assert.equal(cloudinaryCalled, false);
    assert.equal(mongoDeleteCalled, false);
  });

  it("reports partial success when emptying trash", async () => {
    const successfulDocument = {
      ...fakeDocument,
      _id: new Types.ObjectId(),
      status: "DELETED",
    };
    const failedDocument = {
      ...fakeDocument,
      _id: new Types.ObjectId(),
      status: "DELETED",
    };

    StudyDocument.find = (async () => [successfulDocument, failedDocument]) as unknown as typeof StudyDocument.find;
    DocumentVersion.find = (() => ({ select: async () => [] })) as unknown as typeof DocumentVersion.find;
    DocumentVersion.deleteMany = (async () => ({ acknowledged: true, deletedCount: 0 })) as unknown as typeof DocumentVersion.deleteMany;
    UploadSession.deleteMany = (async () => ({ acknowledged: true, deletedCount: 0 })) as unknown as typeof UploadSession.deleteMany;
    DocumentShare.deleteMany = (async () => ({ acknowledged: true, deletedCount: 0 })) as unknown as typeof DocumentShare.deleteMany;
    DocumentShareInvitation.deleteMany = (async () => ({ acknowledged: true, deletedCount: 0 })) as unknown as typeof DocumentShareInvitation.deleteMany;
    DocumentStar.deleteMany = (async () => ({ acknowledged: true, deletedCount: 0 })) as unknown as typeof DocumentStar.deleteMany;
    StudyMaterial.updateMany = (async () => ({ acknowledged: true, modifiedCount: 0 })) as unknown as typeof StudyMaterial.updateMany;
    ChatHistory.updateMany = (async () => ({ acknowledged: true, modifiedCount: 0 })) as unknown as typeof ChatHistory.updateMany;
    ChatThread.updateMany = (async () => ({ acknowledged: true, modifiedCount: 0 })) as unknown as typeof ChatThread.updateMany;
    BenchmarkQuestion.updateMany = (async () => ({ acknowledged: true, modifiedCount: 0 })) as unknown as typeof BenchmarkQuestion.updateMany;
    StudyDocument.deleteOne = (async () => ({ acknowledged: true, deletedCount: 1 })) as unknown as typeof StudyDocument.deleteOne;
    (
      vectorService as typeof vectorService & {
        deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
      }
    ).deleteDocumentChunks = async (documentId: string) => {
      if (documentId === failedDocument._id.toString()) {
        throw new Error("Pinecone timeout");
      }
      return { deletedVectorCount: 1 };
    };

    const result = await emptyTrashDocuments(ownerId.toString());

    assert.equal(result.deletedCount, 1);
    assert.equal(result.failedCount, 1);
    assert.equal(result.failures[0].documentId, failedDocument._id.toString());
    assert.equal(result.failures[0].stage, "PINECONE");
  });
});
