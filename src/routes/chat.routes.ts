import { Router } from "express";
import {
  ask,
  getChatHistory,
  getChatThread,
  listChatHistory,
  listChatThreads,
  removeChatThread,
  removeChatHistory,
  updateChatThread,
} from "../controllers/chat.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  askQuestionSchema,
  chatHistoryIdSchema,
  chatThreadIdSchema,
  updateChatThreadSchema,
} from "../validations/chat.validation";

const router = Router();

router.use(authMiddleware);

router.post("/ask", validateRequest(askQuestionSchema), ask);
router.get("/threads", listChatThreads);
router.get("/threads/:threadId", validateRequest(chatThreadIdSchema), getChatThread);
router.patch(
  "/threads/:threadId",
  validateRequest(updateChatThreadSchema),
  updateChatThread,
);
router.delete(
  "/threads/:threadId",
  validateRequest(chatThreadIdSchema),
  removeChatThread,
);
router.get("/history", listChatHistory);
router.get("/history/:id", validateRequest(chatHistoryIdSchema), getChatHistory);
router.delete(
  "/history/:id",
  validateRequest(chatHistoryIdSchema),
  removeChatHistory,
);

export default router;
