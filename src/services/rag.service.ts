import { StudyDocument } from "../models/document.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatSource,
  ReindexDocumentResponse,
} from "../types/api.types";
import { RagAnswerResult } from "../types/rag.types";
import { splitTextIntoChunks } from "../utils/textSplitter";
import { AppError } from "../middlewares/error.middleware";
import {
  generateAnswerFromContext,
  generateEntityExtractionAnswer,
} from "./groq.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import { detectQuestionIntent } from "../utils/ragIntent";
import {
  detectAnswerStyle,
  getInsufficientContextAnswer,
} from "../utils/answerStyle";
import {
  deleteDocumentChunks,
  searchRelevantChunks,
  upsertDocumentChunks,
} from "./vector.service";

const DEFAULT_CONTEXT_CHUNK_LIMIT = 5;
const FOCUSED_CONTEXT_CHUNK_LIMIT = 3;

export const indexDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<Omit<ReindexDocumentResponse, "deletedVectorCount">> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    uploadedBy: userId,
  });

  if (!document || !document.extractedText.trim()) {
    return {
      documentId,
      chunksCreated: 0,
      detectedSections: [],
      upsertedVectorCount: 0,
    };
  }

  // RAG indexing: split extracted PDF text into overlapping chunks, then store
  // chunk vectors in Pinecone with metadata for later filtered retrieval.
  const chunks = await splitTextIntoChunks(document.extractedText);

  const vectorChunks = chunks.map((chunk) => ({
    documentId: document._id.toString(),
    userId,
    subject: document.subject,
    title: document.title,
    chunkIndex: chunk.chunkIndex,
    section: chunk.metadata.section,
    content: chunk.content,
    metadata: chunk.metadata,
  }));
  const upsertedVectorCount = await upsertDocumentChunks(vectorChunks);
  const detectedSections = [
    ...new Set(chunks.map((chunk) => chunk.metadata.section)),
  ];

  console.log("[RAG reindex] Indexed document chunks", {
    documentId,
    chunksCreated: chunks.length,
    detectedSections,
    upsertedVectorCount,
  });

  return {
    documentId,
    chunksCreated: chunks.length,
    detectedSections,
    upsertedVectorCount,
  };
};

export const reindexDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<ReindexDocumentResponse> => {
  const deleteResult = await deleteDocumentChunks(documentId, userId);
  const indexResult = await indexDocumentForRag(documentId, userId);
  const result = {
    ...indexResult,
    deletedVectorCount: deleteResult.deletedVectorCount,
  };

  console.log("[RAG reindex] Document reindexed", result);

  return result;
};

export const reembedDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<ReindexDocumentResponse> => {
  // Re-embedding deletes stale Pinecone vectors, regenerates chunks with the
  // latest section metadata, then upserts fresh embeddings.
  return reindexDocumentForRag(documentId, userId);
};

export const removeDocumentFromRag = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  await deleteDocumentChunks(documentId, userId);
};

export const askQuestionWithRag = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const startedAt = Date.now();

  if (payload.documentId) {
    const document = await StudyDocument.findOne({
      _id: payload.documentId,
      uploadedBy: userId,
    });

    if (!document) {
      throw new AppError("Document not found", 404);
    }
  }

  // RAG retrieval: Pinecone filters by user and optionally document/subject,
  // then returns the most relevant chunks for the user's question.
  const chunks = await searchRelevantChunks(payload.question, {
    userId,
    documentId: payload.documentId,
    subject: payload.documentId ? undefined : payload.subject,
  });
  const intent = detectQuestionIntent(payload.question);
  const answerStyle = detectAnswerStyle(payload.question);
  const insufficientContextAnswer = getInsufficientContextAnswer(
    answerStyle.language,
  );

  if (chunks.length === 0) {
    return {
      answer: insufficientContextAnswer,
      mode: "basic",
      originalQuestion: payload.question,
      sources: [],
      evaluation: {
        retrievedChunksCount: 0,
        relevantChunksCount: 0,
        averageRelevanceScore: 0,
        correctiveAttempted: false,
        isGrounded: false,
        confidenceScore: 0,
        responseTimeMs: Date.now() - startedAt,
        detectedIntent: intent,
        retrievedSections: [],
      },
    };
  }

  const answerChunks =
    intent === "entity_extraction" || answerStyle.wantsShortAnswer
      ? [...chunks]
          .sort((a, b) => (b.pineconeScore ?? 0) - (a.pineconeScore ?? 0))
          .slice(0, FOCUSED_CONTEXT_CHUNK_LIMIT)
      : chunks.slice(0, DEFAULT_CONTEXT_CHUNK_LIMIT);

  const context = answerChunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}, section ${chunk.metadata.section}\n${chunk.content}`,
    )
    .join("\n\n");

  let answer =
    intent === "entity_extraction"
      ? await generateEntityExtractionAnswer(payload.question, context)
      : await generateAnswerFromContext(payload.question, context, false, {
          intent,
        });
  let grounding = await checkAnswerGrounding(answer, context);

  if (!grounding.isGrounded) {
    answer =
      intent === "entity_extraction"
        ? await generateEntityExtractionAnswer(payload.question, context)
        : await generateAnswerFromContext(payload.question, context, true, {
            intent,
          });
    grounding = await checkAnswerGrounding(answer, context);
  }

  const sources: ChatSource[] = answerChunks.map((chunk) => ({
    documentId: chunk.metadata.documentId,
    title: chunk.metadata.title,
    chunkIndex: Number(chunk.metadata.chunkIndex),
    section: chunk.metadata.section,
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
  }));

  return {
    answer: answer || insufficientContextAnswer,
    mode: "basic",
    originalQuestion: payload.question,
    sources,
    evaluation: {
      retrievedChunksCount: chunks.length,
      relevantChunksCount: chunks.length,
      averageRelevanceScore: chunks.length > 0 ? 1 : 0,
      correctiveAttempted: false,
      isGrounded: grounding.isGrounded,
      confidenceScore: grounding.confidenceScore,
      responseTimeMs: Date.now() - startedAt,
      warning: grounding.warning,
      detectedIntent: intent,
      retrievedSections: [
        ...new Set(chunks.map((chunk) => chunk.metadata.section)),
      ],
    },
  };
};
