import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import {
  checkDocumentsReadiness,
  isActiveVersionReadyForChat,
} from "./chatScope.service";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";

const originalDocumentVersionFindOne = DocumentVersion.findOne;

type VersionSnapshot = {
  processingStatus?: string;
  indexedAt?: Date | null;
  totalChunks?: number;
} | null;

/** Stubs the active-version lookup with a fixed snapshot. */
const mockActiveVersion = (version: VersionSnapshot) => {
  (DocumentVersion as unknown as { findOne: unknown }).findOne = () => ({
    select: async () => version,
  });
};

const doc = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  title: "Getting Things Done",
  ...overrides,
});

afterEach(() => {
  DocumentVersion.findOne = originalDocumentVersionFindOne;
});

describe("chatScope.service readiness check", () => {
  it("treats null active version as ready for legacy docs", () => {
    assert.equal(isActiveVersionReadyForChat(null), true);
  });

  it("treats active version with 0 totalChunks as not ready", () => {
    assert.equal(
      isActiveVersionReadyForChat({
        processingStatus: "INDEXED",
        indexedAt: new Date(),
        totalChunks: 0,
      }),
      false,
    );
  });

  it("treats active version with positive totalChunks as ready", () => {
    assert.equal(
      isActiveVersionReadyForChat({
        processingStatus: "INDEXED",
        indexedAt: new Date(),
        totalChunks: 12,
      }),
      true,
    );
  });
});

describe("chatScope.service checkDocumentsReadiness", () => {
  it("returns neutral state for an empty document set", async () => {
    const result = await checkDocumentsReadiness([]);
    assert.equal(result.hasProcessingDocument, false);
    assert.deepEqual(result.emptyDocumentTitles, []);
  });

  // Regression guard. Much of the existing corpus sits at processingStatus
  // "PENDING" while carrying hundreds of real chunks; if the status check ever
  // moves ahead of the chunk-count check, those documents get reported as still
  // indexing and become unusable in chat.
  it("treats a PENDING version that already has chunks as ready", async () => {
    mockActiveVersion({ processingStatus: "PENDING", totalChunks: 940 });

    const result = await checkDocumentsReadiness([
      doc({ currentVersionId: new Types.ObjectId() }),
    ]);

    assert.equal(result.hasProcessingDocument, false);
    assert.deepEqual(result.emptyDocumentTitles, []);
  });

  it("reports a PENDING version with no chunks as still processing", async () => {
    mockActiveVersion({ processingStatus: "PENDING", totalChunks: 0 });

    const result = await checkDocumentsReadiness([
      doc({ currentVersionId: new Types.ObjectId() }),
    ]);

    assert.equal(result.hasProcessingDocument, true);
    assert.deepEqual(result.emptyDocumentTitles, []);
  });

  // The bug this whole change exists for: indexing finished and produced
  // nothing, which must not read as "still processing".
  it("reports an INDEXED version with no chunks as empty, by title", async () => {
    mockActiveVersion({ processingStatus: "INDEXED", totalChunks: 0 });

    const result = await checkDocumentsReadiness([
      doc({ title: "Chương 4 MLN122", currentVersionId: new Types.ObjectId() }),
    ]);

    assert.equal(result.hasProcessingDocument, false);
    assert.deepEqual(result.emptyDocumentTitles, ["Chương 4 MLN122"]);
  });

  it("reports a FAILED version as empty", async () => {
    mockActiveVersion({ processingStatus: "FAILED", totalChunks: 0 });

    const result = await checkDocumentsReadiness([
      doc({ currentVersionId: new Types.ObjectId() }),
    ]);

    assert.deepEqual(result.emptyDocumentTitles, ["Getting Things Done"]);
  });

  it("falls back to document-level chunks when there is no version", async () => {
    const result = await checkDocumentsReadiness([
      doc({ ragStatus: "NOT_AVAILABLE", totalChunks: 940 }),
    ]);

    assert.equal(result.hasProcessingDocument, false);
    assert.deepEqual(result.emptyDocumentTitles, []);
  });

  it("treats a versionless document with no chunks as empty", async () => {
    const result = await checkDocumentsReadiness([
      doc({ title: "Scanned.pdf", ragStatus: "INDEXED", totalChunks: 0 }),
    ]);

    assert.deepEqual(result.emptyDocumentTitles, ["Scanned.pdf"]);
  });

  it("treats a versionless document still indexing as processing", async () => {
    const result = await checkDocumentsReadiness([
      doc({ ragStatus: "INDEXING", totalChunks: 0 }),
    ]);

    assert.equal(result.hasProcessingDocument, true);
    assert.deepEqual(result.emptyDocumentTitles, []);
  });

  it("separates processing and empty documents in one mixed set", async () => {
    const emptyId = new Types.ObjectId();
    (DocumentVersion as unknown as { findOne: unknown }).findOne = (query: {
      _id: Types.ObjectId;
    }) => ({
      select: async () =>
        query._id.equals(emptyId)
          ? { processingStatus: "INDEXED", totalChunks: 0 }
          : { processingStatus: "PENDING", totalChunks: 0 },
    });

    const result = await checkDocumentsReadiness([
      doc({ title: "Empty.pdf", currentVersionId: emptyId }),
      doc({ title: "Indexing.pdf", currentVersionId: new Types.ObjectId() }),
    ]);

    assert.equal(result.hasProcessingDocument, true);
    assert.deepEqual(result.emptyDocumentTitles, ["Empty.pdf"]);
  });

  it("falls back to a placeholder when a document has no title", async () => {
    const result = await checkDocumentsReadiness([
      { _id: new Types.ObjectId(), ragStatus: "INDEXED", totalChunks: 0 },
    ]);

    assert.deepEqual(result.emptyDocumentTitles, ["Untitled Document"]);
  });
});
