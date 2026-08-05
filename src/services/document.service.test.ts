import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import * as ragService from "./rag.service";
import { computeIndexingStatus, reindexUserDocument } from "./document.service";

const originalDocumentFindOne = StudyDocument.findOne;
const originalDocumentUpdateOne = StudyDocument.updateOne;
const originalVersionUpdateOne = DocumentVersion.updateOne;
const originalReembedDocumentForRag = ragService.reembedDocumentForRag;

afterEach(() => {
  StudyDocument.findOne = originalDocumentFindOne;
  StudyDocument.updateOne = originalDocumentUpdateOne;
  DocumentVersion.updateOne = originalVersionUpdateOne;
  (
    ragService as unknown as {
      reembedDocumentForRag: typeof ragService.reembedDocumentForRag;
    }
  ).reembedDocumentForRag = originalReembedDocumentForRag;
});

// The decision shared by createDocument and the re-index path. Marking a
// zero-chunk document INDEXED is what let an unsearchable file look healthy and
// exhaust the agent loop, so both branches are pinned here.
describe("computeIndexingStatus", () => {
  it("marks a document with chunks as indexed, with no error", () => {
    const result = computeIndexingStatus(12, "some extracted text");
    assert.equal(result.status, "INDEXED");
    assert.equal(result.error, "");
  });

  it("blames scanned images when there were no chunks and no text", () => {
    const result = computeIndexingStatus(0, "");
    assert.equal(result.status, "FAILED");
    assert.match(result.error, /scanned images/i);
  });

  it("treats whitespace-only extracted text as no text", () => {
    const result = computeIndexingStatus(0, "   \n\t ");
    assert.equal(result.status, "FAILED");
    assert.match(result.error, /scanned images/i);
  });

  it("reports a different reason when text existed but produced no chunks", () => {
    const result = computeIndexingStatus(0, "real text that failed to chunk");
    assert.equal(result.status, "FAILED");
    assert.match(result.error, /no searchable content/i);
    assert.doesNotMatch(result.error, /scanned images/i);
  });

  it("fails closed when extracted text is undefined", () => {
    const result = computeIndexingStatus(0);
    assert.equal(result.status, "FAILED");
  });
});

describe("legacy document service", () => {
  it("syncs active document chunk counts after legacy reindex", async () => {
    const ownerId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const versionId = new Types.ObjectId();
    let documentUpdate: Record<string, unknown> | undefined;
    let versionUpdate: Record<string, unknown> | undefined;

    StudyDocument.findOne = (async () => ({
      _id: documentId,
      ownerId,
      currentVersionId: versionId,
      status: "ACTIVE",
    })) as typeof StudyDocument.findOne;
    StudyDocument.updateOne = (async (
      _filter: unknown,
      update: Record<string, unknown>,
    ) => {
      documentUpdate = update;
      return { modifiedCount: 1 };
    }) as typeof StudyDocument.updateOne;
    DocumentVersion.updateOne = (async (
      _filter: unknown,
      update: Record<string, unknown>,
    ) => {
      versionUpdate = update;
      return { modifiedCount: 1 };
    }) as typeof DocumentVersion.updateOne;
    (
      ragService as unknown as {
        reembedDocumentForRag: typeof ragService.reembedDocumentForRag;
      }
    ).reembedDocumentForRag = async () => ({
      documentId: documentId.toString(),
      deletedVectorCount: 2,
      chunkingStrategy: "heading-based",
      chunksCreated: 7,
      detectedSections: ["Overview"],
      upsertedVectorCount: 7,
    });

    const result = await reindexUserDocument(
      documentId.toString(),
      ownerId.toString(),
    );

    assert.equal(result.chunksCreated, 7);
    assert.equal(
      (documentUpdate?.$set as Record<string, unknown>)?.totalChunks,
      7,
    );
    assert.equal(
      (versionUpdate?.$set as Record<string, unknown>)?.totalChunks,
      7,
    );
    assert.ok(
      (documentUpdate?.$set as Record<string, unknown>)?.lastIndexedAt instanceof
        Date,
    );
    assert.ok(
      (versionUpdate?.$set as Record<string, unknown>)?.indexedAt instanceof Date,
    );
  });

  it("sets status to FAILED when reindexing produces zero chunks", async () => {
    const ownerId = new Types.ObjectId();
    const documentId = new Types.ObjectId();
    const versionId = new Types.ObjectId();
    let documentUpdate: Record<string, unknown> | undefined;
    let versionUpdate: Record<string, unknown> | undefined;

    StudyDocument.findOne = (async () => ({
      _id: documentId,
      ownerId,
      currentVersionId: versionId,
      status: "ACTIVE",
      extractedText: "",
    })) as typeof StudyDocument.findOne;
    StudyDocument.updateOne = (async (
      _filter: unknown,
      update: Record<string, unknown>,
    ) => {
      documentUpdate = update;
      return { modifiedCount: 1 };
    }) as typeof StudyDocument.updateOne;
    DocumentVersion.updateOne = (async (
      _filter: unknown,
      update: Record<string, unknown>,
    ) => {
      versionUpdate = update;
      return { modifiedCount: 1 };
    }) as typeof DocumentVersion.updateOne;
    (
      ragService as unknown as {
        reembedDocumentForRag: typeof ragService.reembedDocumentForRag;
      }
    ).reembedDocumentForRag = async () => ({
      documentId: documentId.toString(),
      deletedVectorCount: 0,
      chunkingStrategy: "heading-based",
      chunksCreated: 0,
      detectedSections: [],
      upsertedVectorCount: 0,
    });

    const result = await reindexUserDocument(
      documentId.toString(),
      ownerId.toString(),
    );

    assert.equal(result.chunksCreated, 0);
    assert.equal(
      (documentUpdate?.$set as Record<string, unknown>)?.ragStatus,
      "FAILED",
    );
    assert.equal(
      (versionUpdate?.$set as Record<string, unknown>)?.processingStatus,
      "FAILED",
    );
  });
});
