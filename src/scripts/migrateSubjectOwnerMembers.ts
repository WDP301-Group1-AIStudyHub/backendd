import mongoose from "mongoose";
import { connectDatabase } from "../config/db";
import { Subject } from "../modules/subjects/subject.model";
import { SubjectMember } from "../modules/subjects/subjectWorkspace.model";

async function migrateSubjectOwnerMembers(): Promise<void> {
  await connectDatabase();
  const subjects = await Subject.find({}).select("_id ownerId");
  let created = 0;

  for (const subject of subjects) {
    const result = await SubjectMember.updateOne(
      { subjectId: subject._id, userId: subject.ownerId },
      {
        $setOnInsert: {
          subjectId: subject._id,
          userId: subject.ownerId,
          role: "OWNER",
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      created += 1;
    }
  }

  console.log(`Ensured owner memberships for ${subjects.length} subjects (${created} created).`);
}

migrateSubjectOwnerMembers()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
