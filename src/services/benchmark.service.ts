import { BenchmarkQuestion, IBenchmarkQuestion } from "../models/benchmarkQuestion.model";
import { BenchmarkResult, IBenchmarkResult } from "../models/benchmarkResult.model";
import { AppError } from "../middlewares/error.middleware";
import {
  BenchmarkModeSummary,
  BenchmarkQuestionRequest,
  BenchmarkQuestionResponse,
  BenchmarkResultResponse,
  BenchmarkSummaryResponse,
} from "../types/api.types";
import { DrRagAblation, RagMode } from "../types/rag.types";
import { askQuestion } from "./chat.service";
import { askQuestionWithAgent } from "./agenticRag.service";
import { evaluateBenchmarkAnswer } from "./answerEvaluation.service";
import { initTokenTracker, getTokenMetrics, calculateUsdCost } from "../utils/tokenTracker";

const toQuestionResponse = (
  question: IBenchmarkQuestion,
): BenchmarkQuestionResponse => ({
  id: question._id.toString(),
  question: question.question,
  expectedAnswer: question.expectedAnswer,
  expectedChunks: question.expectedChunks,
  subject: question.subject,
  documentId: question.documentId,
  difficulty: question.difficulty,
  createdBy: question.createdBy,
  createdAt: question.createdAt,
  updatedAt: question.updatedAt,
});

const toResultResponse = (result: IBenchmarkResult): BenchmarkResultResponse => ({
  id: result._id.toString(),
  benchmarkQuestionId: result.benchmarkQuestionId,
  question: result.question,
  expectedAnswer: result.expectedAnswer,
  answer: result.answer,
  evaluation: result.evaluation,
  mode: result.mode,
  ablation: result.ablation,
  telemetry: result.telemetry,
  retrievalMetrics: result.retrievalMetrics,
  costMetrics: result.costMetrics,
  exactMatch: result.exactMatch,
  f1Score: result.f1Score,
  createdBy: result.createdBy,
  createdAt: result.createdAt,
});

const computeExactMatch = (pred: string, target: string): boolean => {
  const cleanPred = pred.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
  const cleanTarget = target.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
  return cleanPred === cleanTarget;
};

const computeF1Score = (pred: string, target: string): number => {
  const getTokens = (text: string) => {
    return text.toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g," ")
      .split(/\s+/)
      .filter(Boolean);
  };
  const predTokens = getTokens(pred);
  const targetTokens = getTokens(target);
  
  if (predTokens.length === 0 || targetTokens.length === 0) {
    return predTokens.length === targetTokens.length ? 1 : 0;
  }
  
  const targetCounts = new Map<string, number>();
  for (const t of targetTokens) {
    targetCounts.set(t, (targetCounts.get(t) || 0) + 1);
  }
  
  let commonCount = 0;
  for (const t of predTokens) {
    const count = targetCounts.get(t);
    if (count && count > 0) {
      commonCount += 1;
      targetCounts.set(t, count - 1);
    }
  }
  
  const precision = commonCount / predTokens.length;
  const recall = commonCount / targetTokens.length;
  
  if (precision + recall === 0) return 0;
  return Number(((2 * precision * recall) / (precision + recall)).toFixed(3));
};

export const createBenchmarkQuestion = async (
  userId: string,
  payload: BenchmarkQuestionRequest,
): Promise<BenchmarkQuestionResponse> => {
  const question = await BenchmarkQuestion.create({
    ...payload,
    createdBy: userId,
  });

  return toQuestionResponse(question);
};

export const getBenchmarkQuestions = async (
  userId: string,
): Promise<BenchmarkQuestionResponse[]> => {
  const questions = await BenchmarkQuestion.find({ createdBy: userId }).sort({
    createdAt: -1,
  });

  return questions.map(toQuestionResponse);
};

export const getBenchmarkQuestionById = async (
  userId: string,
  questionId: string,
): Promise<BenchmarkQuestionResponse> => {
  const question = await BenchmarkQuestion.findOne({
    _id: questionId,
    createdBy: userId,
  });

  if (!question) {
    throw new AppError("Benchmark question not found", 404);
  }

  return toQuestionResponse(question);
};

export const updateBenchmarkQuestion = async (
  userId: string,
  questionId: string,
  payload: Partial<BenchmarkQuestionRequest>,
): Promise<BenchmarkQuestionResponse> => {
  const question = await BenchmarkQuestion.findOneAndUpdate(
    { _id: questionId, createdBy: userId },
    payload,
    { new: true, runValidators: true },
  );

  if (!question) {
    throw new AppError("Benchmark question not found", 404);
  }

  return toQuestionResponse(question);
};

export const deleteBenchmarkQuestion = async (
  userId: string,
  questionId: string,
): Promise<void> => {
  const question = await BenchmarkQuestion.findOneAndDelete({
    _id: questionId,
    createdBy: userId,
  });

  if (!question) {
    throw new AppError("Benchmark question not found", 404);
  }
};

export const runBenchmarkQuestion = async (
  userId: string,
  questionId: string,
  mode?: RagMode,
  ablation?: DrRagAblation,
): Promise<BenchmarkResultResponse> => {
  return initTokenTracker(async () => {
    const benchmarkQuestion = await BenchmarkQuestion.findOne({
      _id: questionId,
      createdBy: userId,
    });

    if (!benchmarkQuestion) {
      throw new AppError("Benchmark question not found", 404);
    }

    // Ablations only exist in the DR-RAG graph, so an ablated run implies it.
    const effectiveMode = ablation ? "dr-rag" : mode;
    const basePayload = {
      question: benchmarkQuestion.question,
      documentId: benchmarkQuestion.documentId?.toString(),
      subject: benchmarkQuestion.subject,
      mode: effectiveMode,
      ablation,
    };

    let ragResult;
    if (effectiveMode === "agentic") {
      ragResult = await askQuestionWithAgent(userId, basePayload, {
        persistHistory: false,
      });
    } else {
      ragResult = await askQuestion(userId, basePayload, {
        persistHistory: false,
      });
    }

    const evaluation = await evaluateBenchmarkAnswer(
      benchmarkQuestion.question,
      benchmarkQuestion.expectedAnswer,
      ragResult.answer,
    );

    const exactMatch = computeExactMatch(ragResult.answer, benchmarkQuestion.expectedAnswer);
    const f1Score = computeF1Score(ragResult.answer, benchmarkQuestion.expectedAnswer);

    let retrievalMetrics = { recall5: 0, recall10: 0, mrr: 0, hit5: 0 };
    const expected = benchmarkQuestion.expectedChunks || [];
    const retrieved = ragResult.sources || [];
    if (expected.length > 0) {
      const top5 = retrieved.slice(0, 5);
      const top10 = retrieved.slice(0, 10);
      
      const matched5 = expected.filter(idx => top5.some(s => s.chunkIndex === idx)).length;
      const matched10 = expected.filter(idx => top10.some(s => s.chunkIndex === idx)).length;
      const hit5 = expected.some(idx => top5.some(s => s.chunkIndex === idx)) ? 1 : 0;
      
      let mrr = 0;
      for (let i = 0; i < retrieved.length; i++) {
        if (expected.includes(retrieved[i].chunkIndex)) {
          mrr = 1 / (i + 1);
          break;
        }
      }
      
      retrievalMetrics = {
        recall5: Number((matched5 / expected.length).toFixed(3)),
        recall10: Number((matched10 / expected.length).toFixed(3)),
        mrr: Number(mrr.toFixed(3)),
        hit5,
      };
    }

    const tokens = getTokenMetrics() || { promptTokens: 0, completionTokens: 0, embeddingTokens: 0, embeddingCalls: 0 };
    const costMetrics = {
      promptTokens: tokens.promptTokens,
      completionTokens: tokens.completionTokens,
      embeddingTokens: tokens.embeddingTokens,
      embeddingCalls: tokens.embeddingCalls,
      usdCost: calculateUsdCost(tokens.promptTokens, tokens.completionTokens, tokens.embeddingTokens),
    };

    const benchmarkResult = await BenchmarkResult.create({
      benchmarkQuestionId: benchmarkQuestion._id,
      question: benchmarkQuestion.question,
      expectedAnswer: benchmarkQuestion.expectedAnswer,
      answer: ragResult.answer,
      evaluation,
      mode: effectiveMode ?? ragResult.mode,
      ablation,
      telemetry: ragResult.evaluation,
      retrievalMetrics,
      costMetrics,
      exactMatch,
      f1Score,
      createdBy: userId,
    });

    return toResultResponse(benchmarkResult);
  });
};

const summarizeResults = (results: IBenchmarkResult[]): BenchmarkModeSummary => {
  const totalRuns = results.length;

  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      averageScore: 0,
      averageAnswerCorrectness: 0,
      averageFaithfulness: 0,
      averageRelevance: 0,
      averageCompleteness: 0,
      averageResponseTimeMs: 0,
      averageRecall5: 0,
      averageRecall10: 0,
      averageMrr: 0,
      averageHit5: 0,
      averageExactMatch: 0,
      averageF1Score: 0,
      averagePromptTokens: 0,
      averageCompletionTokens: 0,
      averageEmbeddingTokens: 0,
      averageEmbeddingCalls: 0,
      averageUsdCost: 0,
    };
  }

  const sums = results.reduce(
    (acc, result) => ({
      score: acc.score + result.evaluation.overallScore,
      answerCorrectness:
        acc.answerCorrectness + result.evaluation.answerCorrectness,
      faithfulness: acc.faithfulness + result.evaluation.faithfulness,
      relevance: acc.relevance + result.evaluation.relevance,
      completeness: acc.completeness + result.evaluation.completeness,
      responseTimeMs: acc.responseTimeMs + (result.telemetry?.responseTimeMs || 0),
      timedRuns: acc.timedRuns + (result.telemetry?.responseTimeMs ? 1 : 0),
      recall5: acc.recall5 + (result.retrievalMetrics?.recall5 || 0),
      recall10: acc.recall10 + (result.retrievalMetrics?.recall10 || 0),
      mrr: acc.mrr + (result.retrievalMetrics?.mrr || 0),
      hit5: acc.hit5 + (result.retrievalMetrics?.hit5 || 0),
      exactMatch: acc.exactMatch + (result.exactMatch ? 1 : 0),
      f1Score: acc.f1Score + (result.f1Score || 0),
      promptTokens: acc.promptTokens + (result.costMetrics?.promptTokens || 0),
      completionTokens: acc.completionTokens + (result.costMetrics?.completionTokens || 0),
      embeddingTokens: acc.embeddingTokens + (result.costMetrics?.embeddingTokens || 0),
      embeddingCalls: acc.embeddingCalls + (result.costMetrics?.embeddingCalls || 0),
      usdCost: acc.usdCost + (result.costMetrics?.usdCost || 0),
    }),
    {
      score: 0,
      answerCorrectness: 0,
      faithfulness: 0,
      relevance: 0,
      completeness: 0,
      responseTimeMs: 0,
      timedRuns: 0,
      recall5: 0,
      recall10: 0,
      mrr: 0,
      hit5: 0,
      exactMatch: 0,
      f1Score: 0,
      promptTokens: 0,
      completionTokens: 0,
      embeddingTokens: 0,
      embeddingCalls: 0,
      usdCost: 0,
    },
  );

  return {
    totalRuns,
    averageScore: Number((sums.score / totalRuns).toFixed(3)),
    averageAnswerCorrectness: Number(
      (sums.answerCorrectness / totalRuns).toFixed(3),
    ),
    averageFaithfulness: Number((sums.faithfulness / totalRuns).toFixed(3)),
    averageRelevance: Number((sums.relevance / totalRuns).toFixed(3)),
    averageCompleteness: Number((sums.completeness / totalRuns).toFixed(3)),
    averageResponseTimeMs: sums.timedRuns
      ? Math.round(sums.responseTimeMs / sums.timedRuns)
      : 0,
    averageRecall5: Number((sums.recall5 / totalRuns).toFixed(3)),
    averageRecall10: Number((sums.recall10 / totalRuns).toFixed(3)),
    averageMrr: Number((sums.mrr / totalRuns).toFixed(3)),
    averageHit5: Number((sums.hit5 / totalRuns).toFixed(3)),
    averageExactMatch: Number((sums.exactMatch / totalRuns).toFixed(3)),
    averageF1Score: Number((sums.f1Score / totalRuns).toFixed(3)),
    averagePromptTokens: Math.round(sums.promptTokens / totalRuns),
    averageCompletionTokens: Math.round(sums.completionTokens / totalRuns),
    averageEmbeddingTokens: Math.round(sums.embeddingTokens / totalRuns),
    averageEmbeddingCalls: Number((sums.embeddingCalls / totalRuns).toFixed(1)),
    averageUsdCost: Number((sums.usdCost / totalRuns).toFixed(6)),
  };
};

export const getBenchmarkSummary = async (
  userId: string,
): Promise<BenchmarkSummaryResponse> => {
  const allResults = await BenchmarkResult.find({ createdBy: userId });
  // Legacy results predate the evaluation field; they cannot be scored.
  const results = allResults.filter((result) => result.evaluation);

  const groups: Record<string, IBenchmarkResult[]> = {};
  for (const result of results) {
    const key = `${result.mode || "unknown"}${result.ablation ? `:${result.ablation}` : ""}`;
    (groups[key] ??= []).push(result);
  }

  const byMode: Record<string, BenchmarkModeSummary> = {};
  for (const [mode, group] of Object.entries(groups)) {
    byMode[mode] = summarizeResults(group);
  }

  return {
    ...summarizeResults(results),
    byMode,
  };
};
