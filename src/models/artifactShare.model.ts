import mongoose, { Document, Schema, Types } from "mongoose";

// VIEW only, unlike DocumentShare's VIEW|EDIT: a summary is generated output,
// so there is nothing for a recipient to edit.
export type ArtifactSharePermission = "VIEW";

export interface IArtifactShare extends Document {
  artifactId: Types.ObjectId;
  sharedWithUserId: Types.ObjectId;
  permission: ArtifactSharePermission;
  sharedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const artifactShareSchema = new Schema<IArtifactShare>(
  {
    artifactId: {
      type: Schema.Types.ObjectId,
      ref: "Artifact",
      required: true,
      index: true,
    },
    sharedWithUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    permission: {
      type: String,
      enum: ["VIEW"],
      required: true,
      default: "VIEW",
    },
    sharedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

artifactShareSchema.index(
  { artifactId: 1, sharedWithUserId: 1 },
  { unique: true }
);

export const ArtifactShare = mongoose.model<IArtifactShare>(
  "ArtifactShare",
  artifactShareSchema
);
