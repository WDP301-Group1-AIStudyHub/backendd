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

afterEach(() => {
  Subject.create = originalSubjectCreate;
  Subject.findOne = originalSubjectFindOne;
  Subject.findOneAndUpdate = originalSubjectFindOneAndUpdate;
  StudyDocument.countDocuments = originalDocumentCountDocuments;
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
    StudyDocument.countDocuments = (async () => 0) as typeof StudyDocument.countDocuments;

    await deleteSubject(subjectId.toString(), ownerId.toString());

    assert.equal(deleted, true);
  });

  it("does not delete subjects that still have documents", async () => {
    Subject.findOne = (async () => fakeSubject) as typeof Subject.findOne;
    StudyDocument.countDocuments = (async () => 1) as typeof StudyDocument.countDocuments;

    await assert.rejects(
      () => deleteSubject(subjectId.toString(), ownerId.toString()),
      /Subject is being used by documents/,
    );
  });
});
