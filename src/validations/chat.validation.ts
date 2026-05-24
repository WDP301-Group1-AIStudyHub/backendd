import { z } from "zod";

export const askQuestionSchema = z.object({
  body: z.object({
    question: z.string().trim().min(1).max(2000),
    documentId: z.string().trim().min(1).optional(),
    subject: z.string().trim().min(1).max(80).optional(),
  }),
});

export const chatHistoryIdSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1),
  }),
});
