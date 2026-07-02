import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { Subject } from "../subjects/subject.model";
import { StudyDocument } from "./document.model";
import { DocumentShare } from "../documentShares/documentShare.model";
import {
  createDocumentMetadata,
  getDocuments,
  softDeleteDocument,
  updateDocumentMetadata,
} from "./document.service";

const originalSubjectFindOne = Subject.findOne;
const originalDocumentCreate = StudyDocument.create;
const originalDocumentFind = StudyDocument.find;
const originalDocumentCountDocuments = StudyDocument.countDocuments;
const originalDocumentFindOneAndUpdate = StudyDocument.findOneAndUpdate;
const originalDocumentFindOne = StudyDocument.findOne;
const originalShareDistinct = DocumentShare.distinct;
const originalShareFindOne = DocumentShare.findOne;

afterEach(() => {
  Subject.findOne = originalSubjectFindOne;
  StudyDocument.create = originalDocumentCreate;
  StudyDocument.find = originalDocumentFind;
  StudyDocument.countDocuments = originalDocumentCountDocuments;
  StudyDocument.findOneAndUpdate = originalDocumentFindOneAndUpdate;
  StudyDocument.findOne = originalDocumentFindOne;
  DocumentShare.distinct = originalShareDistinct;
  DocumentShare.findOne = originalShareFindOne;
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
});
