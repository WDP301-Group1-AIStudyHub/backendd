import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateRequest } from "../../middlewares/validate.middleware";
import {
  createUserSubject,
  addWorkspaceDocumentAccess,
  addWorkspaceMember,
  addWorkspaceTeam,
  addWorkspaceTeamMember,
  editWorkspaceDocumentAccess,
  editWorkspaceMemberRole,
  editWorkspaceTeam,
  editUserSubject,
  getUserSubject,
  listWorkspaceDocumentAccess,
  listWorkspaceDocuments,
  listWorkspaceMembers,
  listWorkspaceTeams,
  listUserSubjects,
  removeWorkspaceDocumentAccess,
  removeWorkspaceMember,
  removeWorkspaceTeam,
  removeWorkspaceTeamMember,
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
    semester: z.string().trim().max(80).optional(),
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
      semester: z.string().trim().max(80).optional(),
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

const memberIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    memberId: objectIdSchema,
  }),
});

const teamIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    teamId: objectIdSchema,
  }),
});

const teamMemberIdSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    teamId: objectIdSchema,
    userId: objectIdSchema,
  }),
});

const documentAccessParamsSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    documentId: objectIdSchema,
  }),
});

const documentAccessGrantParamsSchema = z.object({
  params: z.object({
    id: objectIdSchema,
    documentId: objectIdSchema,
    grantId: objectIdSchema,
  }),
});

const listSubjectSchema = z.object({
  query: z.object({
    page: z.string().trim().optional(),
    limit: z.string().trim().optional(),
    search: z.string().trim().optional(),
  }),
});

const memberMutableRoleSchema = z.enum(["ADMIN", "MEMBER"]);
const grantTypeSchema = z.enum(["USER", "TEAM"]);
const grantPermissionSchema = z.enum(["VIEW", "EDIT"]);

const addMemberSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    email: z.string().trim().email(),
    role: memberMutableRoleSchema.optional(),
    teamId: objectIdSchema.optional(),
  }),
});

const updateMemberRoleSchema = memberIdSchema.extend({
  body: z.object({
    role: memberMutableRoleSchema,
  }),
});

const createTeamSchema = z.object({
  params: z.object({
    id: objectIdSchema,
  }),
  body: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
  }),
});

const updateTeamSchema = teamIdSchema.extend({
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(500).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

const addTeamMemberSchema = teamIdSchema.extend({
  body: z.object({
    userId: objectIdSchema,
  }),
});

const createDocumentAccessSchema = documentAccessParamsSchema.extend({
  body: z.object({
    granteeType: grantTypeSchema,
    granteeId: objectIdSchema,
    permission: grantPermissionSchema,
  }),
});

const updateDocumentAccessSchema = documentAccessGrantParamsSchema.extend({
  body: z.object({
    permission: grantPermissionSchema,
  }),
});

const router = Router();

router.use(authMiddleware);

router.post("/", validateRequest(createSubjectSchema), createUserSubject);
router.get("/", validateRequest(listSubjectSchema), listUserSubjects);
router.get("/:id/members", validateRequest(subjectIdSchema), listWorkspaceMembers);
router.post("/:id/members", validateRequest(addMemberSchema), addWorkspaceMember);
router.patch(
  "/:id/members/:memberId/role",
  validateRequest(updateMemberRoleSchema),
  editWorkspaceMemberRole,
);
router.delete(
  "/:id/members/:memberId",
  validateRequest(memberIdSchema),
  removeWorkspaceMember,
);
router.get("/:id/teams", validateRequest(subjectIdSchema), listWorkspaceTeams);
router.post("/:id/teams", validateRequest(createTeamSchema), addWorkspaceTeam);
router.put("/:id/teams/:teamId", validateRequest(updateTeamSchema), editWorkspaceTeam);
router.delete("/:id/teams/:teamId", validateRequest(teamIdSchema), removeWorkspaceTeam);
router.post(
  "/:id/teams/:teamId/members",
  validateRequest(addTeamMemberSchema),
  addWorkspaceTeamMember,
);
router.delete(
  "/:id/teams/:teamId/members/:userId",
  validateRequest(teamMemberIdSchema),
  removeWorkspaceTeamMember,
);
router.get("/:id/documents", validateRequest(subjectIdSchema), listWorkspaceDocuments);
router.get(
  "/:id/documents/:documentId/access",
  validateRequest(documentAccessParamsSchema),
  listWorkspaceDocumentAccess,
);
router.post(
  "/:id/documents/:documentId/access",
  validateRequest(createDocumentAccessSchema),
  addWorkspaceDocumentAccess,
);
router.patch(
  "/:id/documents/:documentId/access/:grantId",
  validateRequest(updateDocumentAccessSchema),
  editWorkspaceDocumentAccess,
);
router.delete(
  "/:id/documents/:documentId/access/:grantId",
  validateRequest(documentAccessGrantParamsSchema),
  removeWorkspaceDocumentAccess,
);
router.get("/:id", validateRequest(subjectIdSchema), getUserSubject);
router.put("/:id", validateRequest(updateSubjectSchema), editUserSubject);
router.delete("/:id", validateRequest(subjectIdSchema), removeUserSubject);

export default router;
