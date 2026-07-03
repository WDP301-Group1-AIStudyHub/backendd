import "dotenv/config";
import { searchRelevantChunks } from "../services/vector.service";

const query = process.argv[2] || "Explain quantum computing";
const userId = process.argv[3]; // User ID is a mandatory filter in this codebase's Pinecone filters

async function main() {
  if (!userId) {
    console.error("\n❌ Error: Please provide a valid userId as the second argument.");
    console.error("Usage: npx ts-node src/scripts/searchChunks.ts \"your query text\" \"your_user_id\"\n");
    process.exit(1);
  }

  console.log(`\n🔍 Searching Pinecone for chunks matching: "${query}"`);
  console.log(`👤 Filtering for User ID: "${userId}"`);
  console.log(`📍 Endpoint URL / Index: ${process.env.PINECONE_INDEX_NAME}\n`);

  try {
    const results = await searchRelevantChunks(query, { userId });
    console.log(`✅ Search complete. Found ${results.length} relevant chunks:`);

    results.forEach((match, idx) => {
      console.log(`\n================== MATCH #${idx + 1} (Similarity Score: ${match.pineconeScore}) ==================`);
      console.log(`📄 Document Title: ${match.metadata.title}`);
      console.log(`🔖 Section: ${match.metadata.sectionTitle || "N/A"}`);
      console.log(`🔢 Chunk Index: ${match.metadata.chunkIndex}`);
      console.log(`📝 Content Preview:\n${match.content}\n`);
    });
  } catch (error) {
    console.error("❌ Vector search failed:", error);
  }
}

main();
