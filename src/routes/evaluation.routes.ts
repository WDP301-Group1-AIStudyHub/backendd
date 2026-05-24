import { Router } from "express";
import {
  evaluationSummary,
  listEvaluationLogs,
} from "../controllers/evaluation.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

router.use(authMiddleware);

router.get("/logs", listEvaluationLogs);
router.get("/summary", evaluationSummary);

export default router;
