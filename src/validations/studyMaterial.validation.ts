import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const generateStudyMaterialSchema = z.object({
  body: z.object({
    documentId: objectIdSchema,
    type: z.enum(["MCQ", "FLASHCARD"]),
    count: z.number().int().min(1).max(20).optional(),
    difficulty: z.string().optional(),
    topicFocus: z.string().optional(),
  }),
});

export const getStudyMaterialByIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

export const getStudyMaterialsByDocSchema = z.object({
  params: z.object({
    documentId: objectIdSchema,
  }),
});
