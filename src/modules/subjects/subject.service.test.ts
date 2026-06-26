import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../documents/document.model";
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
const originalDocumentUpdateMany = StudyDocument.updateMany;

afterEach(() => {
  Subject.create = originalSubjectCreate;
  Subject.findOne = originalSubjectFindOne;
  Subject.findOneAndUpdate = originalSubjectFindOneAndUpdate;
  StudyDocument.countDocuments = originalDocumentCountDocuments;
  StudyDocument.updateMany = originalDocumentUpdateMany;
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
    let softDeleted = false;

    Subject.findOne = (async () => ({
      ...fakeSubject,
      deleteOne: async () => {
        deleted = true;
      },
    })) as typeof Subject.findOne;
    StudyDocument.updateMany = (async () => {
      softDeleted = true;
      return { modifiedCount: 0 };
    }) as unknown as typeof StudyDocument.updateMany;

    await deleteSubject(subjectId.toString(), ownerId.toString());

    assert.equal(deleted, true);
    assert.equal(softDeleted, true);
  });

  it("soft deletes documents before deleting their subject", async () => {
    let deleted = false;
    let capturedFilter: unknown;
    let capturedPayload: unknown;

    Subject.findOne = (async () => ({
      ...fakeSubject,
      deleteOne: async () => {
        deleted = true;
      },
    })) as typeof Subject.findOne;
    StudyDocument.updateMany = (async (filter: unknown, payload: unknown) => {
      capturedFilter = filter;
      capturedPayload = payload;
      return { modifiedCount: 1 };
    }) as unknown as typeof StudyDocument.updateMany;

    await deleteSubject(subjectId.toString(), ownerId.toString());

    assert.equal(deleted, true);
    const filter = capturedFilter as {
      ownerId?: string;
      subjectId?: Types.ObjectId;
      status?: { $ne?: string };
    };
    assert.equal(filter.ownerId, ownerId.toString());
    assert.equal(filter.subjectId?.toString(), subjectId.toString());
    assert.deepEqual(filter.status, { $ne: "DELETED" });
    assert.equal((capturedPayload as { status?: string }).status, "DELETED");
    assert.ok((capturedPayload as { deletedAt?: Date }).deletedAt instanceof Date);
  });
});
