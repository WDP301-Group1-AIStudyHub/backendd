import { Types } from "mongoose";
import { Artifact, IArtifact } from "../models/artifact.model";
import {
  ArtifactShare,
  ArtifactSharePermission,
  IArtifactShare,
} from "../models/artifactShare.model";
import { User } from "../models/user.model";
import { AppError } from "../middlewares/error.middleware";
import { StudyDocument } from "../modules/documents/document.model";
import {
  createOrUpdateDocumentShare,
  getDocumentAccessRole,
} from "../modules/documentShares/documentShare.service";

export interface ArtifactShareResponse {
  id: string;
  artifactId: string;
  sharedWithUser: {
    id: string;
    fullName: string;
    email: string;
    avatar?: string;
  };
  permission: ArtifactSharePermission;
  sharedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

type PopulatedUser = {
  _id: Types.ObjectId;
  fullName: string;
  email: string;
  avatar?: string;
};

const toUserSummary = (
  user: unknown
): ArtifactShareResponse["sharedWithUser"] => {
  const populated = user as PopulatedUser;

  return {
    id: populated._id.toString(),
    fullName: populated.fullName,
    email: populated.email,
    avatar: populated.avatar,
  };
};

export const toArtifactShareResponse = (
  share: IArtifactShare
): ArtifactShareResponse => ({
  id: share._id.toString(),
  artifactId: share.artifactId.toString(),
  sharedWithUser: toUserSummary(share.sharedWithUserId),
  permission: share.permission,
  sharedBy: share.sharedBy.toString(),
  createdAt: share.createdAt,
  updatedAt: share.updatedAt,
});

/**
 * Loads an artifact the caller owns, for the share-management endpoints.
 * Recipients of a share are intentionally rejected: a VIEW share does not
 * carry the right to re-share.
 */
const getOwnedArtifactOrThrow = async (
  artifactId: string,
  userId: string
): Promise<IArtifact> => {
  const artifact = await Artifact.findOne({ _id: artifactId, userId });

  if (!artifact) {
    throw new AppError("Artifact not found", 404);
  }

  return artifact;
};

/**
 * Resolves read access for GET /api/artifacts/:id, which both the owner and
 * share recipients hit. Returns null when the caller has neither.
 */
export const resolveArtifactAccess = async (
  artifactId: string,
  userId: string
): Promise<{ artifact: IArtifact; isOwner: boolean } | null> => {
  const artifact = await Artifact.findById(artifactId);
  if (!artifact) return null;

  if (artifact.userId.toString() === userId) {
    return { artifact, isOwner: true };
  }

  const share = await ArtifactShare.findOne({
    artifactId,
    sharedWithUserId: userId,
  });

  return share ? { artifact, isOwner: false } : null;
};

/**
 * A summary is unreadable in context without its source document, so sharing
 * one also grants VIEW on the document it was generated from — best-effort,
 * and skipped entirely if the recipient already has some access (own,
 * shared, or via subject) so this can never downgrade an existing EDITOR to
 * VIEWER. Never throws: a failure here must not roll back the summary share
 * the caller actually asked for.
 */
const shareSourceDocumentIfNeeded = async (
  summaryDocumentId: Types.ObjectId,
  ownerId: string,
  recipientEmail: string
): Promise<void> => {
  try {
    const document = await StudyDocument.findOne({
      _id: summaryDocumentId,
      status: { $ne: "DELETED" },
    });
    if (!document) return;

    const recipient = await User.findOne({
      email: recipientEmail.toLowerCase(),
    }).select("_id");
    if (!recipient) return;

    const existingRole = await getDocumentAccessRole(
      document,
      recipient._id.toString()
    );
    if (existingRole) return;

    await createOrUpdateDocumentShare(summaryDocumentId.toString(), ownerId, {
      email: recipientEmail,
      permission: "VIEW",
    });
  } catch (error) {
    console.warn("[artifact-share] Failed to share source document", {
      documentId: summaryDocumentId.toString(),
      recipientEmail,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const shareArtifact = async (
  artifactId: string,
  ownerId: string,
  payload: { email: string; permission: ArtifactSharePermission }
): Promise<ArtifactShareResponse> => {
  const artifact = await getOwnedArtifactOrThrow(artifactId, ownerId);

  // "Invite a user in the system" — unlike DocumentShare there is no pending
  // invitation for strangers, because a summary is not a durable asset worth
  // holding a token open for. An unknown address is simply rejected.
  const recipient = await User.findOne({
    email: payload.email.toLowerCase(),
  }).select("_id fullName email avatar");

  if (!recipient) {
    throw new AppError(
      "No account exists with that email address.",
      404,
      "RECIPIENT_NOT_FOUND"
    );
  }

  if (recipient._id.toString() === ownerId) {
    throw new AppError("You cannot share a summary with yourself", 400);
  }

  const share =
    (await ArtifactShare.findOne({
      artifactId,
      sharedWithUserId: recipient._id,
    })) ||
    new ArtifactShare({
      artifactId,
      sharedWithUserId: recipient._id,
      sharedBy: ownerId,
    });

  share.permission = payload.permission;
  share.sharedBy = new Types.ObjectId(ownerId);
  await share.save();
  await share.populate("sharedWithUserId", "_id fullName email avatar");

  if (artifact.type === "SUMMARY" && artifact.summaryDocumentId) {
    await shareSourceDocumentIfNeeded(
      artifact.summaryDocumentId,
      ownerId,
      payload.email
    );
  }

  return toArtifactShareResponse(share);
};

export const listArtifactShares = async (
  artifactId: string,
  ownerId: string
): Promise<ArtifactShareResponse[]> => {
  await getOwnedArtifactOrThrow(artifactId, ownerId);

  const shares = await ArtifactShare.find({ artifactId })
    .populate("sharedWithUserId", "_id fullName email avatar")
    .sort({ createdAt: -1 });

  return shares.map(toArtifactShareResponse);
};

export const revokeArtifactShare = async (
  artifactId: string,
  shareId: string,
  ownerId: string
): Promise<void> => {
  await getOwnedArtifactOrThrow(artifactId, ownerId);

  const result = await ArtifactShare.deleteOne({ _id: shareId, artifactId });

  if (result.deletedCount === 0) {
    throw new AppError("Share not found", 404);
  }
};

export interface SharedArtifactResponse {
  artifact: IArtifact;
  sharedBy: ArtifactShareResponse["sharedWithUser"] | null;
  sharedAt: Date;
}

/**
 * Summaries other people shared with the caller. Deliberately returns the
 * artifact only — no document payload and no generation action — so a
 * recipient can read the summary without holding any right over the source
 * document, and without a path to spend the owner's quota.
 */
export const listArtifactsSharedWithMe = async (
  userId: string
): Promise<SharedArtifactResponse[]> => {
  const shares = await ArtifactShare.find({ sharedWithUserId: userId })
    .populate("sharedBy", "_id fullName email avatar")
    .populate("artifactId")
    .sort({ createdAt: -1 });

  return shares
    .filter((share) => Boolean(share.artifactId))
    .map((share) => ({
      artifact: share.artifactId as unknown as IArtifact,
      sharedBy: share.sharedBy ? toUserSummary(share.sharedBy) : null,
      sharedAt: share.createdAt,
    }));
};
