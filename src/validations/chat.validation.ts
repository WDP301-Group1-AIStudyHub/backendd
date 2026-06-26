import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const askQuestionSchema = z.object({
  body: z.object({
    question: z.string().trim().min(1).max(2000),
    documentId: objectIdSchema.optional(),
    documentIds: z.array(objectIdSchema).min(1).max(20).optional(),
    subject: z.string().trim().min(1).max(80).optional(),
    subjectId: objectIdSchema.optional(),
    scope: z
      .enum(["single_document", "subject_all", "document_set", "library_all"])
      .optional(),
    mode: z.enum(["basic", "corrective"]).optional(),
  }).superRefine((body, ctx) => {
    if (body.documentId && body.documentIds?.length) {
      ctx.addIssue({
        code: "custom",
        message: "Use either documentId or documentIds, not both",
        path: ["documentIds"],
      });
    }

    if (body.scope === "subject_all" && !body.subjectId) {
      ctx.addIssue({
        code: "custom",
        message: "subjectId is required for subject_all scope",
        path: ["subjectId"],
      });
    }

    if (body.scope === "document_set" && !body.documentIds?.length) {
      ctx.addIssue({
        code: "custom",
        message: "documentIds is required for document_set scope",
        path: ["documentIds"],
      });
    }
  }),
});

export const chatHistoryIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});
