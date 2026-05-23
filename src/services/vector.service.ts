import { Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { AppError } from "../middlewares/error.middleware";
import { generateEmbedding, generateEmbeddings } from "./embedding.service";

export interface VectorChunkInput {
  documentId: string;
  userId: string;
  subject?: string;
  title: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, string | number | boolean>;
}

export interface VectorSearchFilters {
  userId: string;
  documentId?: string;
  subject?: string;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  metadata: {
    documentId: string;
    userId: string;
    subject: string;
    title: string;
    chunkIndex: number;
  };
}

interface PineconeChunkMetadata extends RecordMetadata {
  documentId: string;
  userId: string;
  subject: string;
  title: string;
  chunkIndex: number;
  content: string;
}

const getPineconeClient = (): Pinecone => {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new AppError("PINECONE_API_KEY is required for RAG features", 500);
  }

  return new Pinecone({
    apiKey,
  });
};

const getPineconeIndex = () => {
  const indexName = process.env.PINECONE_INDEX_NAME;

  if (!indexName) {
    throw new AppError("PINECONE_INDEX_NAME is required for RAG features", 500);
  }

  return getPineconeClient().index<PineconeChunkMetadata>({
    name: indexName,
  });
};

const getPineconeNamespace = (): string => {
  return process.env.PINECONE_NAMESPACE || "ai-study-hub";
};

const buildPineconeFilter = (
  filters: VectorSearchFilters,
): Record<string, unknown> => {
  const filter: Record<string, unknown> = {
    userId: { $eq: filters.userId },
  };

  if (filters.documentId) {
    filter.documentId = { $eq: filters.documentId };
  }

  if (filters.subject) {
    filter.subject = { $eq: filters.subject };
  }

  return filter;
};

export const upsertDocumentChunks = async (
  chunks: VectorChunkInput[],
): Promise<void> => {
  if (chunks.length === 0) {
    return;
  }

  const index = getPineconeIndex();
  const embeddings = await generateEmbeddings(chunks.map((chunk) => chunk.content));

  await index.upsert({
    namespace: getPineconeNamespace(),
    records: chunks.map((chunk, index) => ({
      id: `${chunk.documentId}:${chunk.chunkIndex}`,
      values: embeddings[index],
      metadata: {
        documentId: chunk.documentId,
        userId: chunk.userId,
        subject: chunk.subject || "",
        title: chunk.title,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        ...chunk.metadata,
      },
    })),
  });
};

export const searchRelevantChunks = async (
  question: string,
  filters: VectorSearchFilters,
  topK = 5,
): Promise<RetrievedChunk[]> => {
  const index = getPineconeIndex();
  const queryEmbedding = await generateEmbedding(question);

  const result = await index.query({
    namespace: getPineconeNamespace(),
    vector: queryEmbedding,
    topK,
    filter: buildPineconeFilter(filters),
    includeMetadata: true,
    includeValues: false,
  });

  return result.matches.map((match) => {
    const metadata = match.metadata;

    return {
      id: match.id,
      content: metadata?.content || "",
      metadata: {
        documentId: metadata?.documentId || "",
        userId: metadata?.userId || "",
        subject: metadata?.subject || "",
        title: metadata?.title || "",
        chunkIndex: Number(metadata?.chunkIndex || 0),
      },
    };
  });
};

export const deleteDocumentChunks = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  const index = getPineconeIndex();

  await index.deleteMany({
    namespace: getPineconeNamespace(),
    filter: {
      documentId: { $eq: documentId },
      userId: { $eq: userId },
    },
  });
};
