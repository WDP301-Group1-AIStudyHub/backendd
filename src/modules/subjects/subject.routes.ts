import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createUserSubject,
  editUserSubject,
  getUserSubject,
  listUserSubjects,
  removeUserSubject,
} from "./subject.controller";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

const createSubjectSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    color: z.string().trim().max(24).optional(),
    code: z.string().trim().max(40).optional(),
  }),
});

const updateSubjectSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      color: z.string().trim().max(24).optional(),
      code: z.string().trim().max(40).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

const subjectIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
});

const listSubjectSchema = z.object({
  query: z.object({
    page: z.string().trim().optional(),
    limit: z.string().trim().optional(),
    search: z.string().trim().optional(),
  }),
});

const router = Router();

router.use(authMiddleware);

router.post("/", validateRequest(createSubjectSchema), createUserSubject);
router.get("/", validateRequest(listSubjectSchema), listUserSubjects);
router.get("/:id", validateRequest(subjectIdSchema), getUserSubject);
router.put("/:id", validateRequest(updateSubjectSchema), editUserSubject);
router.delete("/:id", validateRequest(subjectIdSchema), removeUserSubject);

export default router;
