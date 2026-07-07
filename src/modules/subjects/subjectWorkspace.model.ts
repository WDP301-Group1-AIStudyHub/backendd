import mongoose, { Document, Schema, Types } from "mongoose";

export type SubjectMemberRole = "OWNER" | "ADMIN" | "MEMBER";
export type SubjectGrantType = "USER" | "TEAM";
export type SubjectDocumentPermission = "VIEW" | "EDIT";

export interface ISubjectMember extends Document {
  subjectId: Types.ObjectId;
  userId: Types.ObjectId;
  role: SubjectMemberRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubjectTeam extends Document {
  subjectId: Types.ObjectId;
  name: string;
  description?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubjectTeamMember extends Document {
  subjectId: Types.ObjectId;
  teamId: Types.ObjectId;
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISubjectDocumentAccess extends Document {
  subjectId: Types.ObjectId;
  documentId: Types.ObjectId;
  granteeType: SubjectGrantType;
  granteeId: Types.ObjectId;
  permission: SubjectDocumentPermission;
  grantedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const subjectMemberSchema = new Schema<ISubjectMember>(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["OWNER", "ADMIN", "MEMBER"],
      default: "MEMBER",
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

const subjectTeamSchema = new Schema<ISubjectTeam>(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

const subjectTeamMemberSchema = new Schema<ISubjectTeamMember>(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "SubjectTeam",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

const subjectDocumentAccessSchema = new Schema<ISubjectDocumentAccess>(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: "Document",
      required: true,
      index: true,
    },
    granteeType: {
      type: String,
      enum: ["USER", "TEAM"],
      required: true,
      index: true,
    },
    granteeId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    permission: {
      type: String,
      enum: ["VIEW", "EDIT"],
      required: true,
    },
    grantedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

subjectMemberSchema.index({ subjectId: 1, userId: 1 }, { unique: true });
subjectTeamSchema.index({ subjectId: 1, name: 1 }, { unique: true });
subjectTeamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
subjectTeamMemberSchema.index({ subjectId: 1, userId: 1 });
subjectDocumentAccessSchema.index(
  { documentId: 1, granteeType: 1, granteeId: 1 },
  { unique: true },
);
subjectDocumentAccessSchema.index({ subjectId: 1, granteeType: 1, granteeId: 1 });

export const SubjectMember =
  mongoose.models.SubjectMember ||
  mongoose.model<ISubjectMember>("SubjectMember", subjectMemberSchema);

export const SubjectTeam =
  mongoose.models.SubjectTeam ||
  mongoose.model<ISubjectTeam>("SubjectTeam", subjectTeamSchema);

export const SubjectTeamMember =
  mongoose.models.SubjectTeamMember ||
  mongoose.model<ISubjectTeamMember>(
    "SubjectTeamMember",
    subjectTeamMemberSchema,
  );

export const SubjectDocumentAccess =
  mongoose.models.SubjectDocumentAccess ||
  mongoose.model<ISubjectDocumentAccess>(
    "SubjectDocumentAccess",
    subjectDocumentAccessSchema,
  );
