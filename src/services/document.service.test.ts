import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Types } from "mongoose";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import * as ragService from "./rag.service";
import { reindexUserDocument } from "./document.service";

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
});
