import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const createSubjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().max(40).optional(),
    description: z.string().trim().max(1000).optional(),
  }),
});

export const updateSubjectSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      code: z.string().trim().max(40).optional(),
      description: z.string().trim().max(1000).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

export const subjectIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

export const listSubjectSchema = z.object({
  query: z.object({
    page: z.string().trim().optional(),
    limit: z.string().trim().optional(),
    search: z.string().trim().optional(),
  }),
});
