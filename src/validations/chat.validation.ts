import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const askQuestionSchema = z.object({
  body: z.object({
    question: z.string().trim().min(1).max(2000),
    documentId: objectIdSchema.optional(),
    subject: z.string().trim().min(1).max(80).optional(),
    subjectId: objectIdSchema.optional(),
    mode: z.enum(["basic", "corrective"]).optional(),
  }),
});

export const chatHistoryIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});
