import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createDocument,
  downloadDocument,
  editSharedDocumentProfile,
  editDocument,
  getDocument,
  listSharedWithMe,
  listDocuments,
  removeDocument,
} from "./document.controller";
import documentShareRoutes from "../documentShares/documentShare.routes";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

const visibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);
const editableStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

const createDocumentSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    subjectId: objectIdSchema,
    visibility: visibilitySchema.optional(),
  }),
});

const updateDocumentSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z
    .object({
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(1000).optional(),
      subjectId: objectIdSchema.optional(),
      visibility: visibilitySchema.optional(),
      status: editableStatusSchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

const documentIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

const updateSharedProfileSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z
    .object({
      subjectId: objectIdSchema.nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

const listDocumentSchema = z.object({
  query: z.object({
    page: z.string().trim().optional(),
    limit: z.string().trim().optional(),
    subjectId: objectIdSchema.optional(),
    keyword: z.string().trim().optional(),
    visibility: visibilitySchema.optional(),
    status: editableStatusSchema.optional(),
  }),
});

const router = Router();

router.use(authMiddleware);

router.post("/", validateRequest(createDocumentSchema), createDocument);
router.get("/", validateRequest(listDocumentSchema), listDocuments);
router.get("/shared-with-me", validateRequest(listDocumentSchema), listSharedWithMe);
router.get("/:id/download", validateRequest(documentIdSchema), downloadDocument);
router.patch(
  "/:id/shared-profile",
  validateRequest(updateSharedProfileSchema),
  editSharedDocumentProfile,
);
router.use("/:id/share", documentShareRoutes);
router.get("/:id", validateRequest(documentIdSchema), getDocument);
router.put("/:id", validateRequest(updateDocumentSchema), editDocument);
router.delete("/:id", validateRequest(documentIdSchema), removeDocument);

export default router;
