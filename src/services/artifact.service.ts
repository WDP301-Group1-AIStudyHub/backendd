import { Artifact, ArtifactType, IArtifact } from "../models/artifact.model";
import { AppError } from "../middlewares/error.middleware";
import { resolveChatScope } from "./chatScope.service";
import { runArtifactGenerationWorker } from "./artifact.worker";
import { resolveArtifactAccess } from "./artifactShare.service";
import { ArtifactShare } from "../models/artifactShare.model";

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
  SUMMARY: "Summary",
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

  if (chatScope.emptyDocumentTitles && chatScope.emptyDocumentTitles.length > 0) {
    throw new AppError(
      `Selected document(s) have no readable text: "${chatScope.emptyDocumentTitles.join(", ")}". Try running OCR or uploading a text-based copy.`,
      400
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

export interface ArtifactDetail {
  artifact: IArtifact;
  /** False for a recipient reading a summary that was shared with them. */
  isOwner: boolean;
}

export const getArtifactById = async (
  userId: string,
  id: string
): Promise<ArtifactDetail> => {
  // Share-aware: recipients of a shared summary poll this same endpoint, so an
  // owner-only lookup here would 404 them out of the content they were given.
  const access = await resolveArtifactAccess(id, userId);
  if (!access) {
    throw new AppError("Artifact not found", 404);
  }
  return access;
};

export const deleteArtifact = async (
  userId: string,
  id: string
): Promise<void> => {
  const result = await Artifact.findOneAndDelete({ _id: id, userId });
  if (!result) {
    throw new AppError("Artifact not found or access denied", 404);
  }

  // Shares would otherwise linger and surface as blank rows in every
  // recipient's "shared with me" list.
  await ArtifactShare.deleteMany({ artifactId: id });
};
