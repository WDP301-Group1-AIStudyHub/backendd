import { Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { AppError } from "../middlewares/error.middleware";
import { SectionLabel } from "../utils/documentSection";
import { generateEmbedding, generateEmbeddings } from "./embedding.service";

export interface VectorChunkInput {
  documentId: string;
  userId: string;
  subject?: string;
  title: string;
  chunkIndex: number;
  section?: SectionLabel;
  inferredSection?: string;
  semanticSectionLabel?: string;
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
  pineconeScore?: number;
  metadata: {
    documentId: string;
    userId: string;
    subject: string;
    title: string;
    chunkIndex: number;
    section?: SectionLabel;
    inferredSection?: string;
    semanticSectionLabel?: string;
  };
}

export interface DeleteDocumentChunksResult {
  deletedVectorCount: number;
}

interface PineconeChunkMetadata extends RecordMetadata {
  documentId: string;
  userId: string;
  subject: string;
  title: string;
  chunkIndex: number;
  section: SectionLabel;
  inferredSection: string;
  semanticSectionLabel: string;
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
): Promise<number> => {
  if (chunks.length === 0) {
    return 0;
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
        section: chunk.section || "",
        inferredSection: chunk.inferredSection || chunk.section || "",
        semanticSectionLabel: chunk.semanticSectionLabel || chunk.section || "",
        content: chunk.content,
        ...chunk.metadata,
      },
    })),
  });

  return chunks.length;
};

const listDocumentVectorIds = async (documentId: string): Promise<string[]> => {
  const index = getPineconeIndex();
  const vectorIds: string[] = [];
  let paginationToken: string | undefined;

  do {
    const result = await index.listPaginated({
      namespace: getPineconeNamespace(),
      prefix: `${documentId}:`,
      limit: 100,
      paginationToken,
    });

    vectorIds.push(
      ...(result.vectors
        ?.map((vector) => vector.id)
        .filter((id): id is string => Boolean(id)) ?? []),
    );
    paginationToken = result.pagination?.next;
  } while (paginationToken);

  return vectorIds;
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
      pineconeScore: match.score,
      metadata: {
        documentId: metadata?.documentId || "",
        userId: metadata?.userId || "",
        subject: metadata?.subject || "",
        title: metadata?.title || "",
        chunkIndex: Number(metadata?.chunkIndex || 0),
        section: (metadata?.section as SectionLabel | undefined) || undefined,
        inferredSection:
          (metadata?.inferredSection as string | undefined) || undefined,
        semanticSectionLabel:
          (metadata?.semanticSectionLabel as string | undefined) || undefined,
      },
    };
  });
};

export const deleteDocumentChunks = async (
  documentId: string,
  userId: string,
): Promise<DeleteDocumentChunksResult> => {
  const index = getPineconeIndex();
  let vectorIds: string[] = [];

  try {
    vectorIds = await listDocumentVectorIds(documentId);
  } catch (error) {
    console.warn("[RAG reindex] Could not list document vector ids before delete", {
      documentId,
      error: error instanceof Error ? error.message : error,
    });
  }

  if (vectorIds.length > 0) {
    await index.deleteMany({
      namespace: getPineconeNamespace(),
      ids: vectorIds,
    });

    console.log("[RAG reindex] Deleted document vectors by id", {
      documentId,
      deletedVectorCount: vectorIds.length,
    });

    return {
      deletedVectorCount: vectorIds.length,
    };
  }

  await index.deleteMany({
    namespace: getPineconeNamespace(),
    filter: {
      documentId: { $eq: documentId },
      userId: { $eq: userId },
    },
  });

  console.log("[RAG reindex] Deleted document vectors by metadata filter", {
    documentId,
    deletedVectorCount: 0,
  });

  return {
    deletedVectorCount: 0,
  };
};
