import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

const booleanFormSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional();

export const uploadDocumentVersionSchema = z.object({
  params: z.object({
    documentId: objectIdSchema,
  }),
  body: z.object({
    uploadMode: z.enum(["OVERRIDE", "APPEND"]),
    uploadReason: z.string().trim().max(500).optional(),
    makeActive: booleanFormSchema,
  }),
});

export const listDocumentVersionsSchema = z.object({
  params: z.object({
    documentId: objectIdSchema,
  }),
  query: z.object({
    page: z.string().trim().optional(),
    limit: z.string().trim().optional(),
  }),
});

export const documentVersionIdSchema = z.object({
  params: z.object({
    documentId: objectIdSchema,
    versionId: objectIdSchema,
  }),
});

export const getDocumentVersionDetailSchema = z.object({
  params: z.object({
    documentId: objectIdSchema,
    versionId: objectIdSchema,
  }),
  query: z.object({
    includeText: z.enum(["true", "false"]).optional(),
  }),
});
