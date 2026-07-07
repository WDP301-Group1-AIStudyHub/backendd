import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import type { DocumentRagStatus } from "../documents/document.model";
import { StudyDocument } from "../documents/document.model";
import * as vectorService from "../../services/vector.service";
import { Subject } from "./subject.model";
import {
  createSubject,
  deleteSubject,
  updateSubject,
} from "./subject.service";

const originalSubjectCreate = Subject.create;
const originalSubjectFindOne = Subject.findOne;
const originalSubjectFindOneAndUpdate = Subject.findOneAndUpdate;
const originalDocumentCountDocuments = StudyDocument.countDocuments;
const originalDocumentFind = StudyDocument.find;
const originalDocumentFindByIdAndUpdate = StudyDocument.findByIdAndUpdate;
const originalDeleteDocumentChunks = vectorService.deleteDocumentChunks;

afterEach(() => {
  Subject.create = originalSubjectCreate;
  Subject.findOne = originalSubjectFindOne;
  Subject.findOneAndUpdate = originalSubjectFindOneAndUpdate;
  StudyDocument.countDocuments = originalDocumentCountDocuments;
  StudyDocument.find = originalDocumentFind;
  StudyDocument.findByIdAndUpdate = originalDocumentFindByIdAndUpdate;
  (vectorService as unknown as {
    deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
  }).deleteDocumentChunks = originalDeleteDocumentChunks;
});

const ownerId = new Types.ObjectId();
const subjectId = new Types.ObjectId();

const fakeSubject = {
  _id: subjectId,
  ownerId,
  name: "PRM392",
  description: "Mobile Programming",
  color: "#2563eb",
  code: "PRM392",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deleteOne: async () => undefined,
};

describe("subject service", () => {
  it("creates subjects for the owner", async () => {
    let createPayload: unknown;

    Subject.findOne = (async () => null) as typeof Subject.findOne;
    Subject.create = (async (payload: unknown) => {
      createPayload = payload;
      return fakeSubject;
    }) as typeof Subject.create;

    const result = await createSubject(ownerId.toString(), {
      name: "PRM392",
      description: "Mobile Programming",
    });

    assert.equal(result.name, "PRM392");
    assert.deepEqual(createPayload, {
      name: "PRM392",
      description: "Mobile Programming",
      color: undefined,
      code: undefined,
      ownerId: ownerId.toString(),
    });
  });

  it("updates subjects owned by the user", async () => {
    Subject.findOne = (async () => null) as typeof Subject.findOne;
    Subject.findOneAndUpdate = (async (_filter: unknown, payload: unknown) => ({
      ...fakeSubject,
      ...payload as object,
    })) as typeof Subject.findOneAndUpdate;
    StudyDocument.countDocuments = (async () => 0) as typeof StudyDocument.countDocuments;

    const result = await updateSubject(subjectId.toString(), ownerId.toString(), {
      name: "SWD392",
    });

    assert.equal(result.name, "SWD392");
  });

  it("deletes subjects without documents", async () => {
    let deleted = false;

    Subject.findOne = (async () => ({
      ...fakeSubject,
      deleteOne: async () => {
        deleted = true;
      },
    })) as typeof Subject.findOne;
    StudyDocument.find = (async () => []) as unknown as typeof StudyDocument.find;

    await deleteSubject(subjectId.toString(), ownerId.toString());

    assert.equal(deleted, true);
  });

  it("soft deletes documents and removes their vectors before deleting their subject", async () => {
    let deleted = false;
    const documentId = new Types.ObjectId();
    const capturedUpdates: unknown[] = [];
    const cleanedDocumentIds: string[] = [];

    Subject.findOne = (async () => ({
      ...fakeSubject,
      deleteOne: async () => {
        deleted = true;
      },
    })) as typeof Subject.findOne;
    StudyDocument.find = (async (filter: unknown) => {
      const query = filter as {
        ownerId?: string;
        subjectId?: Types.ObjectId;
        status?: { $ne?: string };
      };
      assert.equal(query.ownerId, ownerId.toString());
      assert.equal(query.subjectId?.toString(), subjectId.toString());
      assert.deepEqual(query.status, { $ne: "DELETED" });
      return [{ _id: documentId }];
    }) as unknown as typeof StudyDocument.find;
    StudyDocument.findByIdAndUpdate = (async (_id: unknown, payload: unknown) => {
      assert.equal((_id as Types.ObjectId).toString(), documentId.toString());
      capturedUpdates.push(payload);
      return null;
    }) as unknown as typeof StudyDocument.findByIdAndUpdate;
    (vectorService as unknown as {
      deleteDocumentChunks: typeof vectorService.deleteDocumentChunks;
    }).deleteDocumentChunks = async (id: string) => {
      cleanedDocumentIds.push(id);
      return { deletedVectorCount: 2 };
    };

    await deleteSubject(subjectId.toString(), ownerId.toString());

    assert.equal(deleted, true);
    assert.deepEqual(cleanedDocumentIds, [documentId.toString()]);
    assert.equal((capturedUpdates[0] as { status?: string }).status, "DELETED");
    assert.equal(
      (capturedUpdates[0] as { ragStatus?: DocumentRagStatus }).ragStatus,
      "DELETE_PENDING",
    );
    assert.ok((capturedUpdates[0] as { deletedAt?: Date }).deletedAt instanceof Date);
    assert.equal(
      (capturedUpdates[1] as { ragStatus?: DocumentRagStatus }).ragStatus,
      "DELETED",
    );
    assert.equal((capturedUpdates[1] as { totalChunks?: number }).totalChunks, 0);
  });
});
