import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

export const sharePermissionSchema = z.enum(["VIEW", "EDIT"]);

export const documentShareParamsSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

export const createDocumentShareSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    email: z.string().trim().email().toLowerCase(),
    permission: sharePermissionSchema,
  }),
});

export const updateDocumentShareSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    shareId: objectIdSchema,
  }),
  body: z.object({
    permission: sharePermissionSchema,
  }),
});

export const revokeDocumentShareSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    shareId: objectIdSchema,
  }),
});
