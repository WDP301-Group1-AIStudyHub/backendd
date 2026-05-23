import { StudyDocument } from "../models/document.model";
import {
  AskQuestionRequest,
  AskQuestionResponse,
  ChatSource,
} from "../types/api.types";
import { splitTextIntoChunks } from "../utils/textSplitter";
import { AppError } from "../middlewares/error.middleware";
import { generateAnswerFromContext } from "./embedding.service";
import {
  deleteDocumentChunks,
  searchRelevantChunks,
  upsertDocumentChunks,
} from "./vector.service";

const INSUFFICIENT_CONTEXT_ANSWER =
  "Tôi không tìm thấy thông tin này trong tài liệu đã upload.";

export const indexDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    uploadedBy: userId,
  });

  if (!document || !document.extractedText.trim()) {
    return;
  }

  // RAG indexing: split extracted PDF text into overlapping chunks, then store
  // chunk vectors in Pinecone with metadata for later filtered retrieval.
  const chunks = await splitTextIntoChunks(document.extractedText);

  await upsertDocumentChunks(
    chunks.map((chunk) => ({
      documentId: document._id.toString(),
      userId,
      subject: document.subject,
      title: document.title,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      metadata: chunk.metadata,
    })),
  );
};

export const reindexDocumentForRag = async (
  documentId: string,
  userId: string,
): Promise<void> => {
  await deleteDocumentChunks(documentId, userId);
  await indexDocumentForRag(documentId, userId);
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
): Promise<AskQuestionResponse> => {
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

  if (chunks.length === 0) {
    return {
      answer: INSUFFICIENT_CONTEXT_ANSWER,
      sources: [],
    };
  }

  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}\n${chunk.content}`,
    )
    .join("\n\n");

  const answer = await generateAnswerFromContext(payload.question, context);

  const sources: ChatSource[] = chunks.map((chunk) => ({
    documentId: chunk.metadata.documentId,
    title: chunk.metadata.title,
    chunkIndex: Number(chunk.metadata.chunkIndex),
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
  }));

  return {
    answer: answer || INSUFFICIENT_CONTEXT_ANSWER,
    sources,
  };
};
