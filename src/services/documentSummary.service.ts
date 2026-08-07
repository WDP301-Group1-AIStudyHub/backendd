import { Artifact, IArtifact } from "../models/artifact.model";
import { StudyDocument } from "../modules/documents/document.model";
import { AppError } from "../middlewares/error.middleware";
import { resolveCredentialForUser } from "./aiCredentialContext";
import { assertQuotaAvailable, recordMessage } from "./aiUsage.service";
import { runArtifactGenerationWorker } from "./artifact.worker";

export interface DocumentSummaryResult {
  artifact: IArtifact;
  /** True when an existing summary was returned without spending a prompt. */
  cached: boolean;
}

/**
 * Charges one prompt against the weekly allowance. Called on exactly the two
 * paths that reach the model — a first generation and a retry after failure —
 * so a cache hit, which returns before this runs, costs the user nothing.
 * Throws 429 when the allowance is spent.
 */
const chargeOnePrompt = async (
  userId: string,
  isAdmin: boolean
): Promise<void> => {
  const credential = await resolveCredentialForUser(userId);
  await assertQuotaAvailable(userId, credential, isAdmin);
  await recordMessage(userId, { degraded: credential.degraded });
};

/**
 * Fire-and-forget, matching the REPORT pattern: the caller gets 202 and the
 * frontend polls GET /api/artifacts/:id for the result. Always called last,
 * because the worker starts writing status the moment it is invoked.
 */
const dispatchWorker = (artifactId: string, documentId: string): void => {
  runArtifactGenerationWorker(artifactId, "SUMMARY", { documentId }, undefined).catch(
    (err) => {
      console.error(
        `Uncaught error in summary worker for artifact ${artifactId}:`,
        err
      );
    }
  );
};

/**
 * Read-only lookup — never creates or charges. Lets the frontend restore an
 * already-generated summary on page load without risking a silent quota
 * charge for a document that was never summarized (that's what the POST
 * endpoint above is for, and it's deliberately only triggered by a click).
 */
export const getExistingDocumentSummary = async (
  userId: string,
  documentId: string
): Promise<IArtifact | null> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  if (document.ownerId.toString() !== userId) {
    throw new AppError(
      "Only the document owner can view this.",
      403,
      "FORBIDDEN_NOT_OWNER"
    );
  }

  return Artifact.findOne({ summaryDocumentId: documentId });
};

export const createDocumentSummary = async (
  userId: string,
  documentId: string,
  options: { isAdmin?: boolean } = {}
): Promise<DocumentSummaryResult> => {
  const document = await StudyDocument.findOne({
    _id: documentId,
    status: { $ne: "DELETED" },
  });

  if (!document) {
    throw new AppError("Document not found", 404);
  }

  // Owner-only, checked against ownerId directly rather than via
  // getDocumentAccessRole: that helper also reports OWNER for admins and for
  // subject-workspace owners, and RULE-01's anti-evasion intent is that
  // exactly one account — the uploader — can spend quota on this document.
  // Enforced here at the API layer because hiding the button in the UI does
  // not stop anyone from calling this endpoint directly.
  if (document.ownerId.toString() !== userId) {
    throw new AppError(
      "Only the document owner can create a summary.",
      403,
      "FORBIDDEN_NOT_OWNER"
    );
  }

  const existing = await Artifact.findOne({ summaryDocumentId: documentId });

  // A finished or in-flight summary is served as-is. Re-generating is
  // deliberately not offered: the summary has no options to vary, so a second
  // press could only ever spend another prompt to get the same thing.
  if (existing && existing.status !== "FAILED") {
    return { artifact: existing, cached: true };
  }

  const text = document.extractedText?.trim();
  if (!text) {
    throw new AppError(
      "This document has no readable text yet. Wait for processing to finish, or upload a text-based copy.",
      400,
      "DOCUMENT_NOT_READABLE"
    );
  }

  // A previous failure reuses its row instead of creating a second one, which
  // keeps the unique cache key intact while still allowing a retry. Quota is
  // charged before the reset so a 429 leaves the FAILED state untouched.
  if (existing) {
    await chargeOnePrompt(userId, options.isAdmin ?? false);

    const reset = await Artifact.findOneAndUpdate(
      { _id: existing._id },
      { status: "PENDING", $unset: { error: "", content: "" } },
      { new: true }
    );

    dispatchWorker(existing._id.toString(), documentId);
    return { artifact: reset ?? existing, cached: false };
  }

  let artifact: IArtifact;
  try {
    artifact = await Artifact.create({
      userId,
      type: "SUMMARY",
      status: "PENDING",
      title: document.title,
      sourceDocumentIds: [document._id],
      summaryDocumentId: document._id,
      subjectId: document.subjectId || undefined,
      scope: "single_document",
    });
  } catch (error: any) {
    // Lost a race against a concurrent press; the winner's artifact is the one
    // summary this document gets, and only the winner was charged.
    if (error?.code === 11000) {
      const winner = await Artifact.findOne({ summaryDocumentId: documentId });
      if (winner) {
        return { artifact: winner, cached: true };
      }
    }
    throw error;
  }

  try {
    await chargeOnePrompt(userId, options.isAdmin ?? false);
  } catch (error) {
    // A quota rejection must not leave a permanent PENDING row holding the
    // cache key — that would lock the document out of ever being summarized.
    await Artifact.deleteOne({ _id: artifact._id });
    throw error;
  }

  dispatchWorker(artifact._id.toString(), documentId);
  return { artifact, cached: false };
};
