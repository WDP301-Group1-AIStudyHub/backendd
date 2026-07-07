const numberFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

export const RAG_CONFIG = {
  // Selects the retrieval engine for chat questions that do not set an
  // explicit internal mode. "study-agent" keeps the existing
  // basic/corrective graph; "dr-rag" switches to the DR-RAG graph.
  engine: process.env.RAG_ENGINE === "dr-rag" ? "dr-rag" : "study-agent",
  relevanceThreshold: numberFromEnv(process.env.RELEVANCE_THRESHOLD, 0.55),
  pineconeRelevanceThreshold: numberFromEnv(
    process.env.PINECONE_RELEVANCE_THRESHOLD,
    0.3,
  ),
  outOfScopeThreshold: numberFromEnv(
    process.env.PINECONE_OUT_OF_SCOPE_THRESHOLD,
    0.55,
  ),
  minRelevantChunks: numberFromEnv(process.env.MIN_RELEVANT_CHUNKS, 3),
};
