import { z } from "zod";

export const benchmarkQuestionSchema = z.object({
  body: z.object({
    question: z.string().trim().min(1).max(2000),
    expectedAnswer: z.string().trim().min(1).max(5000),
    subject: z.string().trim().max(80).optional(),
    documentId: z.string().trim().min(1).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]),
  }),
});

export const updateBenchmarkQuestionSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1),
  }),
  body: z
    .object({
      question: z.string().trim().min(1).max(2000).optional(),
      expectedAnswer: z.string().trim().min(1).max(5000).optional(),
      subject: z.string().trim().max(80).optional(),
      documentId: z.string().trim().min(1).optional(),
      difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

export const benchmarkQuestionIdSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1),
  }),
});

export const runBenchmarkSchema = z.object({
  params: z.object({
    questionId: z.string().trim().min(1),
  }),
});
