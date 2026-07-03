import { Router } from "express";
import { ask } from "../controllers/agent.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import { agentAskSchema } from "../validations/agent.validation";

const router = Router();

router.use(authMiddleware);

router.post("/ask", validateRequest(agentAskSchema), ask);

export default router;
