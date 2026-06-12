import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const uploadDocumentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    subject: z.string().trim().max(80).optional(),
    subjectId: objectIdSchema,
  }),
});

export const updateDocumentSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      subject: z.string().trim().max(80).optional(),
      subjectId: objectIdSchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

export const documentIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

export const documentReindexSchema = z.object({
  params: z.object({
    documentId: objectIdSchema,
  }),
});

export const searchDocumentSchema = z.object({
  query: z.object({
    keyword: z.string().trim().optional(),
    subject: z.string().trim().optional(),
    subjectId: objectIdSchema.optional(),
  }),
});
