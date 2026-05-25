import { Router } from "express";
import {
  benchmarkSummary,
  createQuestion,
  editQuestion,
  getQuestion,
  listQuestions,
  removeQuestion,
  runQuestionBenchmark,
} from "../controllers/benchmark.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import {
  benchmarkQuestionIdSchema,
  benchmarkQuestionSchema,
  runBenchmarkSchema,
  updateBenchmarkQuestionSchema,
} from "../validations/benchmark.validation";

const router = Router();

router.use(authMiddleware);

router.post("/questions", validateRequest(benchmarkQuestionSchema), createQuestion);
router.get("/questions", listQuestions);
router.get("/questions/:id", validateRequest(benchmarkQuestionIdSchema), getQuestion);
router.put(
  "/questions/:id",
  validateRequest(updateBenchmarkQuestionSchema),
  editQuestion,
);
router.delete(
  "/questions/:id",
  validateRequest(benchmarkQuestionIdSchema),
  removeQuestion,
);
router.post(
  "/run/:questionId",
  validateRequest(runBenchmarkSchema),
  runQuestionBenchmark,
);
router.get("/summary", benchmarkSummary);

export default router;
