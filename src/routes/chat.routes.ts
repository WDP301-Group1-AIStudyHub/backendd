import { Router } from "express";
import {
  ask,
  getChatHistory,
  listChatHistory,
  removeChatHistory,
} from "../controllers/chat.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  askQuestionSchema,
  chatHistoryIdSchema,
} from "../validations/chat.validation";

const router = Router();

router.use(authMiddleware);

router.post("/ask", validateRequest(askQuestionSchema), ask);
router.get("/history", listChatHistory);
router.get("/history/:id", validateRequest(chatHistoryIdSchema), getChatHistory);
router.delete(
  "/history/:id",
  validateRequest(chatHistoryIdSchema),
  removeChatHistory,
);

export default router;
