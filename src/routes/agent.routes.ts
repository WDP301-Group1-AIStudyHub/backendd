import { Router } from "express";
import { ask, askStream } from "../controllers/agent.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import { agentAskSchema } from "../validations/agent.validation";

const router = Router();

router.use(authMiddleware);

router.post("/ask", validateRequest(agentAskSchema), ask);
router.post("/ask/stream", validateRequest(agentAskSchema), askStream);

export default router;
