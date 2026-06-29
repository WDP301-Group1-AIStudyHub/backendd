const numberFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

export const RAG_CONFIG = {
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
