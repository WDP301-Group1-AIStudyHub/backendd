import { Artifact, ArtifactType, IArtifact } from "../models/artifact.model";
import { AppError } from "../middlewares/error.middleware";
import { resolveChatScope } from "./chatScope.service";
import { runArtifactGenerationWorker } from "./artifact.worker";

export interface InitiateArtifactParams {
  type: ArtifactType;
  title?: string;
  instructions?: string;
  threadId?: string;
  documentId?: string;
  documentIds?: string[];
  subject?: string;
  subjectId?: string;
  scope?: "single_document" | "subject_all" | "document_set" | "library_all";
}

const DEFAULT_TITLES: Record<ArtifactType, string> = {
  FLASHCARD: "Flashcards",
  QUIZ: "Quiz",
  MINDMAP: "Mind map",
  REPORT: "Report",
  DATA_TABLE: "Data table",
};

export const initiateArtifactGeneration = async (
  userId: string,
  params: InitiateArtifactParams
): Promise<IArtifact> => {
  const chatScope = await resolveChatScope(userId, {
    question: params.instructions || DEFAULT_TITLES[params.type],
    documentId: params.documentId,
    documentIds: params.documentIds,
    subject: params.subject,
    subjectId: params.subjectId,
    scope: params.scope,
  });

  if (chatScope.hasProcessingDocument) {
    throw new AppError(
      "A selected document is still being processed. Try again once it finishes.",
      409
    );
  }

  const title =
    params.title?.trim() ||
    (params.instructions?.trim()
      ? `${DEFAULT_TITLES[params.type]} - ${params.instructions.trim().slice(0, 60)}`
      : DEFAULT_TITLES[params.type]);

  const sourceDocumentIds =
    chatScope.documentIds ?? (chatScope.documentId ? [chatScope.documentId] : []);

  const artifact = await Artifact.create({
    userId,
    threadId: params.threadId || undefined,
    type: params.type,
    status: "PENDING",
    title,
    instructions: params.instructions,
    sourceDocumentIds,
    subjectId: chatScope.subjectId || undefined,
    scope: chatScope.scope,
  });

  // Fire-and-forget: generation completes in the background while the caller
  // (REST endpoint or agent tool) returns immediately.
  runArtifactGenerationWorker(
    artifact._id.toString(),
    params.type,
    chatScope.vectorFilters,
    params.instructions
  ).catch((err) => {
    console.error(
      `Uncaught error in artifact generation worker for ID ${artifact._id}:`,
      err
    );
  });

  return artifact;
};

export const listArtifacts = async (
  userId: string,
  filters: { threadId?: string } = {}
): Promise<IArtifact[]> => {
  const query: Record<string, unknown> = { userId };
  if (filters.threadId === "none") {
    query.threadId = { $exists: false };
  } else if (filters.threadId) {
    query.threadId = filters.threadId;
  }
  return Artifact.find(query).sort({ createdAt: -1 });
};

export const getArtifactById = async (
  userId: string,
  id: string
): Promise<IArtifact> => {
  const artifact = await Artifact.findOne({ _id: id, userId });
  if (!artifact) {
    throw new AppError("Artifact not found", 404);
  }
  return artifact;
};

export const deleteArtifact = async (
  userId: string,
  id: string
): Promise<void> => {
  const result = await Artifact.findOneAndDelete({ _id: id, userId });
  if (!result) {
    throw new AppError("Artifact not found or access denied", 404);
  }
};
