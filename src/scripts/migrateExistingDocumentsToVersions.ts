import mongoose from "mongoose";
import { connectDatabase } from "../config/db";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { splitTextForRag } from "../utils/textSplitter";

const migrateExistingDocumentsToVersions = async (): Promise<void> => {
  await connectDatabase();

  const documents = await StudyDocument.find({
    fileUrl: { $nin: [null, ""] },
    $or: [
      { currentVersionId: { $exists: false } },
      { currentVersionId: null },
      { totalVersions: { $in: [null, 0] } },
    ],
  });
  let migratedCount = 0;

  for (const document of documents) {
    const existingVersion = await DocumentVersion.findOne({
      documentId: document._id,
    }).select("_id");

    if (existingVersion) {
      document.currentVersionId = existingVersion._id;
      document.totalVersions = await DocumentVersion.countDocuments({
        documentId: document._id,
        deletedAt: null,
      });
      await document.save();
      continue;
    }

    const chunkingResult = await splitTextForRag(document.extractedText || "");
    const version = await DocumentVersion.create({
      documentId: document._id,
      versionNumber: 1,
      uploadMode: "OVERRIDE",
      fileUrl: document.fileUrl || "",
      filePublicId: document.filePublicId || "",
      fileName: document.fileName || "document",
      originalFileName: document.originalFileName || document.fileName || "document",
      storedFileName: document.storedFileName || document.fileName || "document",
      fileType: document.fileType || document.mimeType || "application/octet-stream",
      mimeType: document.mimeType || document.fileType || "application/octet-stream",
      fileSize: document.fileSize || 0,
      fileExtension: document.fileExtension || "",
      extractedText: document.extractedText || "",
      extractionStatus: document.extractionStatus || "COMPLETED",
      extractionError: document.extractionError || "",
      totalChunks: chunkingResult.chunks.length,
      uploadedBy: document.ownerId,
      isActive: true,
      indexedAt: document.lastIndexedAt || null,
      uploadReason: "Migrated from legacy document fields",
    });

    document.currentVersionId = version._id;
    document.totalVersions = 1;
    document.totalChunks = version.totalChunks;
    document.lastIndexedAt = version.indexedAt;
    await document.save();
    migratedCount += 1;
  }

  console.log(`Migrated ${migratedCount} existing documents to version 1`);
};

migrateExistingDocumentsToVersions()
  .catch((error) => {
    console.error("Existing document version migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
