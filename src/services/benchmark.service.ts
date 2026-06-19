import { BenchmarkQuestion, IBenchmarkQuestion } from "../models/benchmarkQuestion.model";
import { BenchmarkResult, IBenchmarkResult } from "../models/benchmarkResult.model";
import { AppError } from "../middlewares/error.middleware";
import {
  BenchmarkQuestionRequest,
  BenchmarkQuestionResponse,
  BenchmarkResultResponse,
  BenchmarkSummaryResponse,
  BenchmarkWinner,
} from "../types/api.types";
import { askQuestion } from "./chat.service";
import { evaluateBenchmarkAnswer } from "./answerEvaluation.service";

const toQuestionResponse = (
  question: IBenchmarkQuestion,
): BenchmarkQuestionResponse => ({
  id: question._id.toString(),
  question: question.question,
  expectedAnswer: question.expectedAnswer,
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
  basicAnswer: result.basicAnswer,
  correctiveAnswer: result.correctiveAnswer,
  basicEvaluation: result.basicEvaluation,
  correctiveEvaluation: result.correctiveEvaluation,
  winner: result.winner,
  createdBy: result.createdBy,
  createdAt: result.createdAt,
});

const decideWinner = (
  basicScore: number,
  correctiveScore: number,
): BenchmarkWinner => {
  if (correctiveScore > basicScore + 0.05) {
    return "corrective";
  }

  if (basicScore > correctiveScore + 0.05) {
    return "basic";
  }

  return "tie";
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
): Promise<BenchmarkResultResponse> => {
  const benchmarkQuestion = await BenchmarkQuestion.findOne({
    _id: questionId,
    createdBy: userId,
  });

  if (!benchmarkQuestion) {
    throw new AppError("Benchmark question not found", 404);
  }

  const basePayload = {
    question: benchmarkQuestion.question,
    documentId: benchmarkQuestion.documentId?.toString(),
    subject: benchmarkQuestion.subject,
  };

  // Reuse the same chat/RAG service twice so benchmark behavior matches
  // production chat behavior exactly.
  const basicResult = await askQuestion(userId, {
    ...basePayload,
    mode: "basic",
  }, { persistHistory: false });
  const correctiveResult = await askQuestion(userId, {
    ...basePayload,
    mode: "corrective",
  }, { persistHistory: false });

  const basicEvaluation = await evaluateBenchmarkAnswer(
    benchmarkQuestion.question,
    benchmarkQuestion.expectedAnswer,
    basicResult.answer,
  );
  const correctiveEvaluation = await evaluateBenchmarkAnswer(
    benchmarkQuestion.question,
    benchmarkQuestion.expectedAnswer,
    correctiveResult.answer,
  );
  const winner = decideWinner(
    basicEvaluation.overallScore,
    correctiveEvaluation.overallScore,
  );

  const benchmarkResult = await BenchmarkResult.create({
    benchmarkQuestionId: benchmarkQuestion._id,
    question: benchmarkQuestion.question,
    expectedAnswer: benchmarkQuestion.expectedAnswer,
    basicAnswer: basicResult.answer,
    correctiveAnswer: correctiveResult.answer,
    basicEvaluation,
    correctiveEvaluation,
    winner,
    createdBy: userId,
  });

  return toResultResponse(benchmarkResult);
};

export const getBenchmarkSummary = async (
  userId: string,
): Promise<BenchmarkSummaryResponse> => {
  const results = await BenchmarkResult.find({ createdBy: userId });

  if (results.length === 0) {
    return {
      totalRuns: 0,
      basicAverageScore: 0,
      correctiveAverageScore: 0,
      correctiveWinRate: 0,
      basicWinRate: 0,
      tieRate: 0,
      averageFaithfulnessImprovement: 0,
      averageCorrectnessImprovement: 0,
    };
  }

  const totalRuns = results.length;
  const sums = results.reduce(
    (acc, result) => ({
      basicScore: acc.basicScore + result.basicEvaluation.overallScore,
      correctiveScore:
        acc.correctiveScore + result.correctiveEvaluation.overallScore,
      basicWins: acc.basicWins + (result.winner === "basic" ? 1 : 0),
      correctiveWins:
        acc.correctiveWins + (result.winner === "corrective" ? 1 : 0),
      ties: acc.ties + (result.winner === "tie" ? 1 : 0),
      faithfulnessImprovement:
        acc.faithfulnessImprovement +
        (result.correctiveEvaluation.faithfulness -
          result.basicEvaluation.faithfulness),
      correctnessImprovement:
        acc.correctnessImprovement +
        (result.correctiveEvaluation.answerCorrectness -
          result.basicEvaluation.answerCorrectness),
    }),
    {
      basicScore: 0,
      correctiveScore: 0,
      basicWins: 0,
      correctiveWins: 0,
      ties: 0,
      faithfulnessImprovement: 0,
      correctnessImprovement: 0,
    },
  );

  return {
    totalRuns,
    basicAverageScore: Number((sums.basicScore / totalRuns).toFixed(2)),
    correctiveAverageScore: Number(
      (sums.correctiveScore / totalRuns).toFixed(2),
    ),
    correctiveWinRate: Number((sums.correctiveWins / totalRuns).toFixed(2)),
    basicWinRate: Number((sums.basicWins / totalRuns).toFixed(2)),
    tieRate: Number((sums.ties / totalRuns).toFixed(2)),
    averageFaithfulnessImprovement: Number(
      (sums.faithfulnessImprovement / totalRuns).toFixed(2),
    ),
    averageCorrectnessImprovement: Number(
      (sums.correctnessImprovement / totalRuns).toFixed(2),
    ),
  };
};
