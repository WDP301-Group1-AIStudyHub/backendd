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
import {
  createDocumentMetadata,
  getDocuments,
  permanentlyDeleteDocumentRecord,
  setDocumentStar,
  softDeleteDocument,
  updateDocumentMetadata,
} from "./document.service";

const originalSubjectFindOne = Subject.findOne;
const originalDocumentCreate = StudyDocument.create;
const originalDocumentFind = StudyDocument.find;
const originalDocumentCountDocuments = StudyDocument.countDocuments;
const originalDocumentFindOneAndUpdate = StudyDocument.findOneAndUpdate;
const originalDocumentFindOne = StudyDocument.findOne;
const originalDocumentDeleteOne = StudyDocument.deleteOne;
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
const originalSessionDeleteMany = UploadSession.deleteMany;
const originalDeleteCloudinaryFile = cloudinaryService.deleteCloudinaryFile;
const originalDeleteDocumentChunks = vectorService.deleteDocumentChunks;

afterEach(() => {
  Subject.findOne = originalSubjectFindOne;
  StudyDocument.create = originalDocumentCreate;
  StudyDocument.find = originalDocumentFind;
  StudyDocument.countDocuments = originalDocumentCountDocuments;
  StudyDocument.findOneAndUpdate = originalDocumentFindOneAndUpdate;
  StudyDocument.findOne = originalDocumentFindOne;
  StudyDocument.deleteOne = originalDocumentDeleteOne;
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
  UploadSession.deleteMany = originalSessionDeleteMany;
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

    await softDeleteDocument(fakeDocument._id.toString(), ownerId.toString());

    assert.equal(updatePayload?.status, "DELETED");
    assert.ok(updatePayload?.deletedAt instanceof Date);
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
    assert.deepEqual(deletedCollections.sort(), [
      "document",
      "invitations",
      "sessions",
      "shares",
      "stars",
      "versions",
    ].sort());
  });
});
