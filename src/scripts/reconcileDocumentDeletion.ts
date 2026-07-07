import mongoose from "mongoose";
import { connectDatabase } from "../config/db";
import cloudinary from "../config/cloudinary";
import { StudyDocument } from "../modules/documents/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { reconcileTrashVectors } from "../modules/documents/document.service";
import { ChatHistory } from "../models/chatHistory.model";
import { StudyMaterial } from "../models/studyMaterial.model";
import { BenchmarkQuestion } from "../models/benchmarkQuestion.model";

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");
const deleteCloudinaryOrphans = execute && args.has("--delete-cloudinary-orphans");
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const listCloudinaryDocumentAssets = async (): Promise<Array<{
  public_id: string;
  created_at?: string;
}>> => {
  const assets: Array<{ public_id: string; created_at?: string }> = [];
  let nextCursor: string | undefined;
  do {
    const page = await cloudinary.api.resources({
      resource_type: "raw",
      type: "upload",
      prefix: "ai-study-hub/documents/",
      max_results: 500,
      next_cursor: nextCursor,
    });
    assets.push(...(page.resources || []));
    nextCursor = page.next_cursor;
  } while (nextCursor);
  return assets;
};

const main = async (): Promise<void> => {
  await connectDatabase();
  const documents = await StudyDocument.find({}).select(
    "_id status lastIndexedAt filePublicId ragStatus",
  );
  const documentIds = new Set(documents.map((document) => document._id.toString()));
  const versions = await DocumentVersion.find({}).select("documentId filePublicId");
  const referencedPublicIds = new Set(
    [
      ...documents.map((document) => document.filePublicId),
      ...versions.map((version) => version.filePublicId),
    ].filter((value): value is string => Boolean(value)),
  );
  const orphanChatHistories = await ChatHistory.find({
    documentId: { $exists: true, $ne: null },
  }).select("_id documentId documentIds sources");
  const missingChatReferences = orphanChatHistories.filter(
    (history) => history.documentId && !documentIds.has(history.documentId.toString()),
  );
  const orphanMaterials = (await StudyMaterial.find({ documentId: { $ne: null } }).select(
    "_id documentId title sourceDocumentTitle",
  )).filter(
    (material) => material.documentId && !documentIds.has(material.documentId.toString()),
  );
  const orphanBenchmarks = (await BenchmarkQuestion.find({
    documentId: { $exists: true, $ne: null },
  }).select("_id documentId"))
    .filter((question) => question.documentId && !documentIds.has(question.documentId.toString()));

  let cloudinaryOrphans: Array<{ public_id: string; created_at?: string }> = [];
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    const assets = await listCloudinaryDocumentAssets();
    cloudinaryOrphans = assets.filter((asset) => !referencedPublicIds.has(asset.public_id));
  }

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    documents: documents.length,
    trashDocuments: documents.filter((document) => document.status === "DELETED").length,
    missingChatReferences: missingChatReferences.length,
    orphanStudyMaterials: orphanMaterials.length,
    orphanBenchmarkQuestions: orphanBenchmarks.length,
    cloudinaryOrphans: cloudinaryOrphans.length,
    cloudinaryOrphansEligibleForDelete: cloudinaryOrphans.filter((asset) => {
      const createdAt = asset.created_at ? new Date(asset.created_at).getTime() : 0;
      return createdAt > 0 && Date.now() - createdAt >= ORPHAN_GRACE_MS;
    }).length,
  }, null, 2));

  if (!execute) return;

  await StudyDocument.updateMany(
    { status: "DELETED" },
    { $set: { ragStatus: "DELETE_PENDING", ragStatusUpdatedAt: new Date() } },
  );
  await StudyDocument.updateMany(
    { status: { $ne: "DELETED" }, lastIndexedAt: { $ne: null } },
    { $set: { ragStatus: "INDEXED", ragError: "", ragStatusUpdatedAt: new Date() } },
  );
  await StudyDocument.updateMany(
    { status: { $ne: "DELETED" }, lastIndexedAt: null },
    { $set: { ragStatus: "NOT_AVAILABLE", ragStatusUpdatedAt: new Date() } },
  );
  await reconcileTrashVectors();

  for (const history of missingChatReferences) {
    const sourceDocumentId = history.documentId!.toString();
    await ChatHistory.updateOne(
      { _id: history._id },
      {
        $unset: { documentId: "" },
        $pull: { documentIds: history.documentId },
        $set: {
          sourceStatus: "DELETED",
          sourceDeletedAt: new Date(),
          "sources.$[source].sourceStatus": "DELETED",
          "sources.$[source].sourceDeletedAt": new Date(),
        },
      } as any,
      { arrayFilters: [{ "source.documentId": sourceDocumentId }] },
    );
  }
  for (const material of orphanMaterials) {
    await StudyMaterial.updateOne(
      { _id: material._id },
      {
        $set: {
          documentId: null,
          sourceDocumentId: material.documentId!.toString(),
          sourceDocumentTitle: material.sourceDocumentTitle || material.title,
          sourceStatus: "DELETED",
          sourceDeletedAt: new Date(),
        },
      },
    );
  }
  for (const question of orphanBenchmarks) {
    await BenchmarkQuestion.updateOne(
      { _id: question._id },
      {
        $unset: { documentId: "" },
        $set: {
          sourceDocumentId: question.documentId!.toString(),
          sourceStatus: "DELETED",
          sourceDeletedAt: new Date(),
        },
      },
    );
  }

  if (deleteCloudinaryOrphans) {
    for (const asset of cloudinaryOrphans) {
      const createdAt = asset.created_at ? new Date(asset.created_at).getTime() : 0;
      if (!createdAt || Date.now() - createdAt < ORPHAN_GRACE_MS) continue;
      await cloudinary.uploader.destroy(asset.public_id, { resource_type: "raw" });
    }
  }
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
