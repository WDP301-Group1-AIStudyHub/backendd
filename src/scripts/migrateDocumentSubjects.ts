import mongoose from "mongoose";
import { connectDatabase } from "../config/db";
import { StudyDocument } from "../models/document.model";
import { Subject } from "../models/subject.model";

type LegacyDocumentSubject = {
  _id: mongoose.Types.ObjectId;
  subject?: string;
  ownerId?: mongoose.Types.ObjectId;
  uploadedBy?: mongoose.Types.ObjectId;
};

const migrateDocumentSubjects = async (): Promise<void> => {
  await connectDatabase();

  const documents = await StudyDocument.collection
    .find<LegacyDocumentSubject>({
    $or: [{ subjectId: { $exists: false } }, { subjectId: null }],
    subject: { $nin: [null, ""] },
    })
    .project<LegacyDocumentSubject>({
      _id: 1,
      subject: 1,
      ownerId: 1,
      uploadedBy: 1,
    })
    .toArray();
  let migratedCount = 0;

  for (const document of documents) {
    const subjectName = document.subject?.trim();

    if (!subjectName) {
      continue;
    }
    const ownerId = document.ownerId || document.uploadedBy;

    if (!ownerId) {
      continue;
    }

    const subject = await Subject.findOneAndUpdate(
      {
        ownerId,
        name: subjectName,
      },
      {
        $setOnInsert: {
          name: subjectName,
          code: subjectName,
          description: "",
          ownerId,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    await StudyDocument.updateOne(
      { _id: document._id },
      { $set: { subjectId: subject._id, ownerId } },
    );
    migratedCount += 1;
  }

  console.log(`Migrated ${migratedCount} documents to subjectId`);
};

migrateDocumentSubjects()
  .catch((error) => {
    console.error("Document subject migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
