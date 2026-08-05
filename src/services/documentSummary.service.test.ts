import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { AppError } from "../middlewares/error.middleware";
import { Artifact } from "../models/artifact.model";
import { StudyDocument } from "../modules/documents/document.model";
import * as aiUsageService from "./aiUsage.service";
import * as credentialContext from "./aiCredentialContext";
import * as artifactWorker from "./artifact.worker";
import { createDocumentSummary } from "./documentSummary.service";

const originalDocumentFindOne = StudyDocument.findOne;
const originalArtifactFindOne = Artifact.findOne;
const originalArtifactCreate = Artifact.create;
const originalArtifactDeleteOne = Artifact.deleteOne;
const originalArtifactFindOneAndUpdate = Artifact.findOneAndUpdate;
const originalAssertQuota = aiUsageService.assertQuotaAvailable;
const originalRecordMessage = aiUsageService.recordMessage;
const originalResolveCredential = credentialContext.resolveCredentialForUser;
const originalRunWorker = artifactWorker.runArtifactGenerationWorker;

type Mutable = Record<string, unknown>;

afterEach(() => {
  StudyDocument.findOne = originalDocumentFindOne;
  Artifact.findOne = originalArtifactFindOne;
  Artifact.create = originalArtifactCreate;
  Artifact.deleteOne = originalArtifactDeleteOne;
  Artifact.findOneAndUpdate = originalArtifactFindOneAndUpdate;
  (aiUsageService as Mutable).assertQuotaAvailable = originalAssertQuota;
  (aiUsageService as Mutable).recordMessage = originalRecordMessage;
  (credentialContext as Mutable).resolveCredentialForUser = originalResolveCredential;
  (artifactWorker as Mutable).runArtifactGenerationWorker = originalRunWorker;
});

const ownerId = new Types.ObjectId();
const strangerId = new Types.ObjectId();
const documentId = new Types.ObjectId();
const artifactId = new Types.ObjectId();

const fakeDocument = {
  _id: documentId,
  ownerId,
  subjectId: new Types.ObjectId(),
  title: "Operating Systems chapter 3",
  status: "ACTIVE",
  extractedText: "Processes, threads and scheduling.",
};

/** Records what the flow did so each test can assert on side effects. */
const setup = (
  overrides: {
    document?: unknown;
    existingArtifact?: unknown;
    quotaError?: Error;
    createError?: Error;
  } = {},
) => {
  const calls = {
    quotaChecked: 0,
    promptsRecorded: 0,
    workersDispatched: 0,
    artifactsDeleted: 0,
  };

  StudyDocument.findOne = (async () =>
    "document" in overrides ? overrides.document : fakeDocument) as never;

  Artifact.findOne = (async () => overrides.existingArtifact ?? null) as never;

  Artifact.create = (async (doc: Record<string, unknown>) => {
    if (overrides.createError) throw overrides.createError;
    return {
      ...doc,
      _id: artifactId,
      toJSON: () => doc,
    };
  }) as never;

  Artifact.findOneAndUpdate = (async () => ({
    _id: artifactId,
    status: "PENDING",
  })) as never;

  Artifact.deleteOne = (async () => {
    calls.artifactsDeleted += 1;
    return { deletedCount: 1 };
  }) as never;

  (credentialContext as Mutable).resolveCredentialForUser = async () => ({
    apiKey: "test-key",
    source: "platform" as const,
    degraded: false,
  });

  (aiUsageService as Mutable).assertQuotaAvailable = async () => {
    calls.quotaChecked += 1;
    if (overrides.quotaError) throw overrides.quotaError;
  };

  (aiUsageService as Mutable).recordMessage = async () => {
    calls.promptsRecorded += 1;
  };

  (artifactWorker as Mutable).runArtifactGenerationWorker = async () => {
    calls.workersDispatched += 1;
  };

  return calls;
};

describe("document summary service", () => {
  it("refuses a non-owner with FORBIDDEN_NOT_OWNER before touching quota", async () => {
    // The whole point of the API-layer check: a share recipient calling this
    // endpoint directly must not be able to spend anyone's quota.
    const calls = setup();

    await assert.rejects(
      createDocumentSummary(strangerId.toString(), documentId.toString()),
      (error: AppError) => {
        assert.equal(error.statusCode, 403);
        assert.equal(error.code, "FORBIDDEN_NOT_OWNER");
        return true;
      },
    );

    assert.equal(calls.quotaChecked, 0);
    assert.equal(calls.promptsRecorded, 0);
    assert.equal(calls.workersDispatched, 0);
  });

  it("does not let an admin summarize a document they do not own", async () => {
    const calls = setup();

    await assert.rejects(
      createDocumentSummary(strangerId.toString(), documentId.toString(), {
        isAdmin: true,
      }),
      (error: AppError) => error.code === "FORBIDDEN_NOT_OWNER",
    );

    assert.equal(calls.promptsRecorded, 0);
  });

  it("returns an existing summary without spending a prompt", async () => {
    const calls = setup({
      existingArtifact: { _id: artifactId, status: "COMPLETED" },
    });

    const result = await createDocumentSummary(
      ownerId.toString(),
      documentId.toString(),
    );

    assert.equal(result.cached, true);
    assert.equal(calls.quotaChecked, 0, "a cache hit must not check quota");
    assert.equal(calls.promptsRecorded, 0, "a cache hit must not cost a prompt");
    assert.equal(calls.workersDispatched, 0, "a cache hit must not call the AI");
  });

  it("serves an in-flight summary as cached instead of starting a second one", async () => {
    const calls = setup({
      existingArtifact: { _id: artifactId, status: "GENERATING" },
    });

    const result = await createDocumentSummary(
      ownerId.toString(),
      documentId.toString(),
    );

    assert.equal(result.cached, true);
    assert.equal(calls.workersDispatched, 0);
  });

  it("charges one prompt and dispatches the worker on a first summary", async () => {
    const calls = setup();

    const result = await createDocumentSummary(
      ownerId.toString(),
      documentId.toString(),
    );

    assert.equal(result.cached, false);
    assert.equal(calls.quotaChecked, 1);
    assert.equal(calls.promptsRecorded, 1);
    assert.equal(calls.workersDispatched, 1);
  });

  it("retries a failed summary by reusing its row", async () => {
    const calls = setup({
      existingArtifact: { _id: artifactId, status: "FAILED" },
    });

    const result = await createDocumentSummary(
      ownerId.toString(),
      documentId.toString(),
    );

    assert.equal(result.cached, false);
    assert.equal(calls.promptsRecorded, 1, "a retry does cost a prompt");
    assert.equal(calls.workersDispatched, 1);
  });

  it("deletes the placeholder artifact when quota is exhausted", async () => {
    // Otherwise a 429 would leave a PENDING row holding the unique cache key
    // and the document could never be summarized again.
    const calls = setup({
      quotaError: new AppError("Weekly free quota exhausted.", 429),
    });

    await assert.rejects(
      createDocumentSummary(ownerId.toString(), documentId.toString()),
      (error: AppError) => error.statusCode === 429,
    );

    assert.equal(calls.artifactsDeleted, 1);
    assert.equal(calls.workersDispatched, 0, "no AI call after a 429");
  });

  it("rejects a document with no extracted text before charging", async () => {
    const calls = setup({
      document: { ...fakeDocument, extractedText: "   " },
    });

    await assert.rejects(
      createDocumentSummary(ownerId.toString(), documentId.toString()),
      (error: AppError) => {
        assert.equal(error.statusCode, 400);
        assert.equal(error.code, "DOCUMENT_NOT_READABLE");
        return true;
      },
    );

    assert.equal(calls.promptsRecorded, 0);
  });

  it("returns the winner's artifact when two presses race", async () => {
    const duplicateKeyError = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
    });
    const winner = { _id: artifactId, status: "PENDING" };

    const calls = setup({ createError: duplicateKeyError });
    // First lookup misses (no cache), the post-collision lookup finds the winner.
    let lookups = 0;
    Artifact.findOne = (async () => (lookups++ === 0 ? null : winner)) as never;

    const result = await createDocumentSummary(
      ownerId.toString(),
      documentId.toString(),
    );

    assert.equal(result.cached, true);
    assert.equal(result.artifact, winner as never);
    assert.equal(calls.promptsRecorded, 0, "the loser of the race pays nothing");
  });

  it("404s on a missing document", async () => {
    setup({ document: null });

    await assert.rejects(
      createDocumentSummary(ownerId.toString(), documentId.toString()),
      (error: AppError) => error.statusCode === 404,
    );
  });
});
