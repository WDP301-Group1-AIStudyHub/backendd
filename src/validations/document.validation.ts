import { z } from "zod";

export const uploadDocumentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    subject: z.string().trim().max(80).optional(),
  }),
});

export const updateDocumentSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1),
  }),
  body: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      subject: z.string().trim().max(80).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

export const documentIdSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1),
  }),
});

export const documentReindexSchema = z.object({
  params: z.object({
    documentId: z.string().trim().min(1),
  }),
});

export const searchDocumentSchema = z.object({
  query: z.object({
    keyword: z.string().trim().optional(),
    subject: z.string().trim().optional(),
  }),
});
