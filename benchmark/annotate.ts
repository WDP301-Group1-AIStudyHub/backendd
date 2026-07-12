import dotenv from "dotenv";
import { connectDatabase } from "../src/config/db";
import { BenchmarkQuestion } from "../src/models/benchmarkQuestion.model";
import { searchRelevantChunksPerDocument } from "../src/services/vector.service";
import mongoose from "mongoose";

dotenv.config();

async function main() {
  await connectDatabase();
  console.log("Connected to MongoDB.");

  const questions = await BenchmarkQuestion.find({});
  console.log(`Found ${questions.length} questions to annotate.`);

  let annotated = 0;
  for (const q of questions) {
    if (!q.documentId) {
      console.log(`Skipping question (no documentId): "${q.question.slice(0, 50)}..."`);
      continue;
    }

    if (q.expectedChunks && q.expectedChunks.length > 0) {
      console.log(`Skipping already annotated: "${q.question.slice(0, 50)}..."`);
      continue;
    }

    try {
      const query = q.expectedAnswer;
      const filters = { documentId: q.documentId.toString() };
      
      const chunks = await searchRelevantChunksPerDocument(query, filters, 3);
      if (chunks.length === 0) {
        console.log(`No chunks found in Pinecone for: "${q.question.slice(0, 50)}..."`);
        continue;
      }
      
      const topChunk = chunks[0];
      const chunkIndex = topChunk.metadata.chunkIndex;
      
      q.expectedChunks = [chunkIndex];
      await q.save();
      annotated += 1;
      console.log(`Annotated [${annotated}]: "${q.question.slice(0, 40)}..." -> chunkIndex ${chunkIndex}`);
    } catch (e: any) {
      console.error(`Error annotating "${q.question.slice(0, 40)}":`, e.message || e);
    }
  }

  await mongoose.disconnect();
  console.log(`\nDone: ${annotated} questions annotated.`);
}

main().catch(console.error);
