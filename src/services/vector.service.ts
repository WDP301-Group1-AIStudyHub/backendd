import { Pinecone, RecordMetadata } from "@pinecone-database/pinecone";
import { AppError } from "../middlewares/error.middleware";
import { SectionLabel } from "../utils/documentSection";
import {
  generateEmbedding,
  generateEmbeddings,
  JINA_EMBEDDING_DIMENSION,
} from "./embedding.service";

export interface VectorChunkInput {
  documentId: string;
  versionId?: string;
  versionNumber?: number;
  ownerId?: string;
  userId: string;
  subject?: string;
  subjectId?: string;
  title: string;
  chunkIndex: number;
  heading?: string | null;
  sectionTitle: string;
  sectionIndex: number;
  contentLength: number;
  section?: SectionLabel;
  inferredSection?: string;
  semanticSectionLabel?: string;
  outlineNodeId?: string;
  outlinePath?: string;
  outlineLevel?: number;
  outlineType?: string;
  chapterOrdinal?: string;
  content: string;
  metadata: Record<string, string | number | boolean>;
}

export interface VectorSearchFilters {
  userId?: string;
  documentId?: string;
  documentIds?: string[];
  subject?: string;
  subjectId?: string;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  pineconeScore?: number;
  metadata: {
    documentId: string;
    userId: string;
    subject: string;
    subjectId: string;
    title: string;
    chunkIndex: number;
    heading?: string;
    sectionTitle?: string;
    sectionIndex?: number;
    contentLength?: number;
    section?: SectionLabel;
    inferredSection?: string;
    semanticSectionLabel?: string;
    outlineNodeId?: string;
    outlinePath?: string;
    outlineLevel?: number;
    outlineType?: string;
    chapterOrdinal?: string;
  };
}

export interface DeleteDocumentChunksResult {
  deletedVectorCount: number;
}

interface PineconeChunkMetadata extends RecordMetadata {
  documentId: string;
  versionId: string;
  versionNumber: number;
  ownerId: string;
  isActiveVersion: boolean;
  userId: string;
  subject: string;
  subjectId: string;
  title: string;
  chunkIndex: number;
  heading: string;
  sectionTitle: string;
  sectionIndex: number;
  contentLength: number;
  section: SectionLabel;
  inferredSection: string;
  semanticSectionLabel: string;
  outlineNodeId: string;
  outlinePath: string;
  outlineLevel: number;
  outlineType: string;
  chapterOrdinal: string;
  content: string;
}

const PINECONE_UPSERT_BATCH_SIZE = 100;

const getPineconeClient = (): Pinecone => {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new AppError("PINECONE_API_KEY is required for RAG features", 500);
  }

  return new Pinecone({
    apiKey,
  });
};

const getPineconeIndexName = (): string => {
  const indexName = process.env.PINECONE_INDEX_NAME;

  if (!indexName) {
    throw new AppError("PINECONE_INDEX_NAME is required for RAG features", 500);
  }

  return indexName;
};

let pineconeDimensionCheck:
  | {
      indexName: string;
      promise: Promise<void>;
    }
  | undefined;

const ensurePineconeIndexDimension = async (): Promise<void> => {
  const indexName = getPineconeIndexName();

  if (pineconeDimensionCheck?.indexName === indexName) {
    return pineconeDimensionCheck.promise;
  }

  pineconeDimensionCheck = {
    indexName,
    promise: getPineconeClient()
      .describeIndex(indexName)
      .then((indexDescription) => {
        const actualDimension = indexDescription.dimension;

        if (
          typeof actualDimension === "number" &&
          actualDimension !== JINA_EMBEDDING_DIMENSION
        ) {
          throw new AppError(
            `Pinecone index "${indexName}" dimension is ${actualDimension}, but Jina ${process.env.JINA_EMBEDDING_MODEL || "jina-embeddings-v3"} requires ${JINA_EMBEDDING_DIMENSION}. Create a new Pinecone index with dimension ${JINA_EMBEDDING_DIMENSION} and update PINECONE_INDEX_NAME.`,
            500,
          );
        }
      }),
  };

  return pineconeDimensionCheck.promise;
};

const getPineconeIndex = async () => {
  await ensurePineconeIndexDimension();

  return getPineconeClient().index<PineconeChunkMetadata>({
    name: getPineconeIndexName(),
  });
};

const getPineconeNamespace = (): string => {
  return process.env.PINECONE_NAMESPACE || "ai-study-hub";
};

export const buildPineconeFilter = (
  filters: VectorSearchFilters,
): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};

  if (filters.userId) {
    filter.userId = { $eq: filters.userId };
  }

  if (filters.documentIds?.length) {
    filter.documentId = { $in: filters.documentIds };
  } else if (filters.documentId) {
    filter.documentId = { $eq: filters.documentId };
  }

  if (filters.subject) {
    filter.subject = { $eq: filters.subject };
  }

  if (filters.subjectId) {
    filter.subjectId = { $eq: filters.subjectId };
  }

  return filter;
};

export const upsertDocumentChunks = async (
  chunks: VectorChunkInput[],
): Promise<number> => {
  if (chunks.length === 0) {
    return 0;
  }

  const index = await getPineconeIndex();
  const embeddings = await generateEmbeddings(chunks.map((chunk) => chunk.content));
  const records = chunks.map((chunk, chunkArrayIndex) => ({
    id: chunk.versionId
      ? `${chunk.documentId}:${chunk.versionId}:${chunk.chunkIndex}`
      : `${chunk.documentId}:${chunk.chunkIndex}`,
    values: embeddings[chunkArrayIndex],
    metadata: {
      documentId: chunk.documentId,
      versionId: chunk.versionId || "",
      versionNumber: chunk.versionNumber || 0,
      ownerId: chunk.ownerId || chunk.userId,
      isActiveVersion: true,
      userId: chunk.userId,
      subject: chunk.subject || "",
      subjectId: chunk.subjectId || "",
      title: chunk.title,
      chunkIndex: chunk.chunkIndex,
      heading: chunk.heading || "",
      sectionTitle: chunk.sectionTitle,
      sectionIndex: chunk.sectionIndex,
      contentLength: chunk.contentLength,
      section: chunk.section || "",
      inferredSection: chunk.inferredSection || chunk.section || "",
      semanticSectionLabel: chunk.semanticSectionLabel || chunk.section || "",
      outlineNodeId: chunk.outlineNodeId || "",
      outlinePath: chunk.outlinePath || "",
      outlineLevel: chunk.outlineLevel || 0,
      outlineType: chunk.outlineType || "",
      chapterOrdinal: chunk.chapterOrdinal || "",
      content: chunk.content,
      ...chunk.metadata,
    },
  }));

  for (
    let startIndex = 0;
    startIndex < records.length;
    startIndex += PINECONE_UPSERT_BATCH_SIZE
  ) {
    await index.upsert({
      namespace: getPineconeNamespace(),
      records: records.slice(
        startIndex,
        startIndex + PINECONE_UPSERT_BATCH_SIZE,
      ),
    });
  }

  return chunks.length;
};

const listDocumentVectorIds = async (documentId: string): Promise<string[]> => {
  const index = await getPineconeIndex();
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

const toRetrievedChunk = (
  id: string,
  metadata: PineconeChunkMetadata | undefined,
  pineconeScore?: number,
): RetrievedChunk => ({
  id,
  content: metadata?.content || "",
  pineconeScore,
  metadata: {
    documentId: metadata?.documentId || "",
    userId: metadata?.userId || "",
    subject: metadata?.subject || "",
    subjectId: metadata?.subjectId || "",
    title: metadata?.title || "",
    chunkIndex: Number(metadata?.chunkIndex || 0),
    heading: (metadata?.heading as string | undefined) || undefined,
    sectionTitle:
      (metadata?.sectionTitle as string | undefined) || undefined,
    sectionIndex:
      metadata?.sectionIndex === undefined
        ? undefined
        : Number(metadata.sectionIndex),
    contentLength:
      metadata?.contentLength === undefined
        ? undefined
        : Number(metadata.contentLength),
    section: (metadata?.section as SectionLabel | undefined) || undefined,
    inferredSection:
      (metadata?.inferredSection as string | undefined) || undefined,
    semanticSectionLabel:
      (metadata?.semanticSectionLabel as string | undefined) || undefined,
    outlineNodeId: (metadata?.outlineNodeId as string | undefined) || undefined,
    outlinePath: (metadata?.outlinePath as string | undefined) || undefined,
    outlineLevel:
      metadata?.outlineLevel === undefined
        ? undefined
        : Number(metadata.outlineLevel),
    outlineType: (metadata?.outlineType as string | undefined) || undefined,
    chapterOrdinal:
      (metadata?.chapterOrdinal as string | undefined) || undefined,
  },
});

export const searchRelevantChunks = async (
  questionOrEmbedding: string | number[],
  filters: VectorSearchFilters,
  topK = 5,
): Promise<RetrievedChunk[]> => {
  const index = await getPineconeIndex();
  const queryEmbedding = typeof questionOrEmbedding === "string"
    ? await generateEmbedding(questionOrEmbedding)
    : questionOrEmbedding;

  const result = await index.query({
    namespace: getPineconeNamespace(),
    vector: queryEmbedding,
    topK,
    filter: buildPineconeFilter(filters),
    includeMetadata: true,
    includeValues: false,
  });

  return result.matches.map((match) =>
    toRetrievedChunk(match.id, match.metadata, match.score),
  );
};

/**
 * Queries Pinecone separately for each document to guarantee coverage
 * across all selected documents.  Falls back to a single broad query
 * when the caller did not supply explicit document IDs.
 */
export const searchRelevantChunksPerDocument = async (
  question: string,
  filters: VectorSearchFilters,
  topKPerDocument: number,
): Promise<RetrievedChunk[]> => {
  const documentIds = filters.documentIds;

  if (!documentIds?.length) {
    return searchRelevantChunks(question, filters, topKPerDocument * 3);
  }

  const queryEmbedding = await generateEmbedding(question);
  const perDocTopK = Math.max(topKPerDocument, 4);

  const results = await Promise.all(
    documentIds.map((docId) =>
      searchRelevantChunks(
        queryEmbedding,
        {
          ...filters,
          documentId: docId,
          documentIds: undefined,
        },
        perDocTopK,
      ),
    ),
  );

  return results.flat();
};

export const fetchVectorChunksByIds = async (
  ids: string[],
): Promise<RetrievedChunk[]> => {
  if (ids.length === 0) {
    return [];
  }

  const index = await getPineconeIndex();
  const result = await index.fetch({
    namespace: getPineconeNamespace(),
    ids,
  });

  return Object.values(result.records)
    .map((record) => toRetrievedChunk(record.id, record.metadata))
    .filter((chunk) => Boolean(chunk.content));
};

export const deleteDocumentChunks = async (
  documentId: string,
  userId: string,
): Promise<DeleteDocumentChunksResult> => {
  const index = await getPineconeIndex();
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
