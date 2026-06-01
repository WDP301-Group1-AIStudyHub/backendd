import { StudyDocument } from "../models/document.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatSource,
  ReindexDocumentResponse,
} from "../types/api.types";
import { RagAnswerResult } from "../types/rag.types";
import { splitTextForRag } from "../utils/textSplitter";
import { AppError } from "../middlewares/error.middleware";
import {
  generateAnswerFromContext,
  generateEntityExtractionAnswer,
} from "./groq.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import {
  detectAnswerStyle,
} from "../utils/answerStyle";
import { classifyQuestionIntent } from "./intentClassifier.service";
import {
  deleteDocumentChunks,
  searchRelevantChunks,
  upsertDocumentChunks,
} from "./vector.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";

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

  // RAG indexing only sees normalized plain text. Embedding models do not read
  // PDF/Office binaries directly, so format-specific parsing happens before
  // this unchanged chunking and vector storage step.
  const chunkingResult = await splitTextForRag(document.extractedText);
  const chunks = chunkingResult.chunks;

  const vectorChunks = chunks.map((chunk) => ({
    documentId: document._id.toString(),
    userId,
    subject: document.subject,
    title: document.title,
    chunkIndex: chunk.chunkIndex,
    heading: chunk.metadata.heading,
    sectionTitle: chunk.metadata.sectionTitle,
    sectionIndex: chunk.metadata.sectionIndex,
    contentLength: chunk.metadata.contentLength,
    section: chunk.metadata.section,
    inferredSection: chunk.metadata.inferredSection,
    semanticSectionLabel: chunk.metadata.semanticSectionLabel,
    content: chunk.content,
    metadata: {
      heading: chunk.metadata.heading || "",
      sectionTitle: chunk.metadata.sectionTitle,
      sectionIndex: chunk.metadata.sectionIndex,
      contentLength: chunk.metadata.contentLength,
      chunkingStrategy: chunk.metadata.chunkingStrategy,
      textLength: chunk.metadata.textLength,
      section: chunk.metadata.section || "",
      inferredSection: chunk.metadata.inferredSection || "",
      semanticSectionLabel: chunk.metadata.semanticSectionLabel || "",
    },
  }));
  const upsertedVectorCount = await upsertDocumentChunks(vectorChunks);
  const detectedSections = [
    ...new Set(
      chunks
        .map((chunk) => chunk.metadata.sectionTitle)
        .filter((section): section is string => Boolean(section)),
    ),
  ];

  console.log("[RAG reindex] Indexed document chunks", {
    documentId,
    chunkingStrategy: chunkingResult.chunkingStrategy,
    chunksCreated: chunks.length,
    detectedSections,
    upsertedVectorCount,
  });

  return {
    documentId,
    chunkingStrategy: chunkingResult.chunkingStrategy,
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
  let documentTitle: string | undefined;
  let documentSubject = payload.subject;

  if (payload.documentId) {
    const document = await StudyDocument.findOne({
      _id: payload.documentId,
      uploadedBy: userId,
    });

    if (!document) {
      throw new AppError("Document not found", 404);
    }

    documentTitle = document.title;
    documentSubject = document.subject || documentSubject;
  }

  // RAG retrieval: Pinecone filters by user and optionally document/subject,
  // then returns the most relevant chunks for the user's question.
  const chunks = await searchRelevantChunks(payload.question, {
    userId,
    documentId: payload.documentId,
    subject: payload.documentId ? undefined : payload.subject,
  });
  const intentClassification = await classifyQuestionIntent(payload.question);
  const intent = intentClassification.intent;
  const answerStyle = detectAnswerStyle(payload.question);

  if (chunks.length === 0) {
    const fallbackReason = "no_relevant_chunks_found";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      documentTitle,
      subject: documentSubject,
      reason: fallbackReason,
    });

    return {
      answer: fallbackAnswer,
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
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        retrievedSections: [],
      },
    };
  }

  const answerChunks =
    intent === "extraction" || answerStyle.wantsShortAnswer
      ? [...chunks]
          .sort((a, b) => (b.pineconeScore ?? 0) - (a.pineconeScore ?? 0))
          .slice(0, FOCUSED_CONTEXT_CHUNK_LIMIT)
      : chunks.slice(0, DEFAULT_CONTEXT_CHUNK_LIMIT);

  const context = answerChunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}${
          chunk.metadata.sectionTitle
            ? `, section ${chunk.metadata.sectionTitle}`
            : ""
        }\n${chunk.content}`,
    )
    .join("\n\n");

  let answer =
    intent === "extraction"
      ? await generateEntityExtractionAnswer(payload.question, context)
      : await generateAnswerFromContext(payload.question, context, false, {
          intent,
        });
  let grounding = await checkAnswerGrounding(answer, context);

  if (!grounding.isGrounded) {
    answer =
      intent === "extraction"
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
    inferredSection: chunk.metadata.inferredSection,
    semanticSectionLabel: chunk.metadata.semanticSectionLabel,
    heading: chunk.metadata.heading,
    sectionTitle: chunk.metadata.sectionTitle,
    sectionIndex: chunk.metadata.sectionIndex,
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
  }));

  if (!answer || !grounding.isGrounded) {
    const fallbackReason = !answer ? "empty_answer" : "grounding_failed";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: chunks.length,
      relevantChunksCount: chunks.length,
      averageRelevanceScore: chunks.length > 0 ? 1 : 0,
      documentTitle: documentTitle || answerChunks[0]?.metadata.title,
      subject: documentSubject,
      reason: fallbackReason,
    });

    return {
      answer: fallbackAnswer,
      mode: "basic",
      originalQuestion: payload.question,
      sources,
      evaluation: {
        retrievedChunksCount: chunks.length,
        relevantChunksCount: chunks.length,
        averageRelevanceScore: chunks.length > 0 ? 1 : 0,
        correctiveAttempted: false,
        isGrounded: false,
        confidenceScore: grounding.confidenceScore,
        responseTimeMs: Date.now() - startedAt,
        warning: grounding.warning,
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        retrievedSections: [
          ...new Set(
            chunks
              .map(
                (chunk) =>
                  chunk.metadata.sectionTitle ||
                  chunk.metadata.inferredSection ||
                  chunk.metadata.section ||
                  "",
              )
              .filter(Boolean),
          ),
        ],
      },
    };
  }

  return {
    answer,
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
      fallbackGenerated: false,
      detectedIntent: intent,
      retrievedSections: [
        ...new Set(
          chunks
            .map(
              (chunk) =>
                chunk.metadata.sectionTitle ||
                chunk.metadata.inferredSection ||
                chunk.metadata.section ||
                "",
            )
            .filter(Boolean),
        ),
      ],
    },
  };
};
