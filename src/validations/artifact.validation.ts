import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const createArtifactSchema = z.object({
  body: z.object({
    type: z.enum(["FLASHCARD", "QUIZ", "MINDMAP", "REPORT", "DATA_TABLE"]),
    title: z.string().trim().max(120).optional(),
    instructions: z.string().trim().max(500).optional(),
    threadId: objectIdSchema.optional(),
    documentId: objectIdSchema.optional(),
    documentIds: z.array(objectIdSchema).optional(),
    subject: z.string().trim().optional(),
    subjectId: objectIdSchema.optional(),
    scope: z
      .enum(["single_document", "subject_all", "document_set", "library_all"])
      .optional(),
  }),
});

export const listArtifactsSchema = z.object({
  query: z.object({
    // "none" lists artifacts not attached to any thread (created from a
    // fresh chat before its thread existed).
    threadId: objectIdSchema.or(z.literal("none")).optional(),
  }),
});

export const artifactByIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});
