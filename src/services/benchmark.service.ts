import { BenchmarkQuestion, IBenchmarkQuestion } from "../models/benchmarkQuestion.model";
import { BenchmarkResult, IBenchmarkResult } from "../models/benchmarkResult.model";
import { AppError } from "../middlewares/error.middleware";
import {
  BenchmarkQuestionRequest,
  BenchmarkQuestionResponse,
  BenchmarkResultResponse,
  BenchmarkSummaryResponse,
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
  answer: result.answer,
  evaluation: result.evaluation,
  createdBy: result.createdBy,
  createdAt: result.createdAt,
});

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

  const drRagResult = await askQuestion(userId, basePayload, {
    persistHistory: false,
  });
  const evaluation = await evaluateBenchmarkAnswer(
    benchmarkQuestion.question,
    benchmarkQuestion.expectedAnswer,
    drRagResult.answer,
  );

  const benchmarkResult = await BenchmarkResult.create({
    benchmarkQuestionId: benchmarkQuestion._id,
    question: benchmarkQuestion.question,
    expectedAnswer: benchmarkQuestion.expectedAnswer,
    answer: drRagResult.answer,
    evaluation,
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
      averageScore: 0,
      averageAnswerCorrectness: 0,
      averageFaithfulness: 0,
      averageRelevance: 0,
      averageCompleteness: 0,
    };
  }

  const totalRuns = results.length;
  const sums = results.reduce(
    (acc, result) => ({
      score: acc.score + result.evaluation.overallScore,
      answerCorrectness:
        acc.answerCorrectness + result.evaluation.answerCorrectness,
      faithfulness: acc.faithfulness + result.evaluation.faithfulness,
      relevance: acc.relevance + result.evaluation.relevance,
      completeness: acc.completeness + result.evaluation.completeness,
    }),
    {
      score: 0,
      answerCorrectness: 0,
      faithfulness: 0,
      relevance: 0,
      completeness: 0,
    },
  );

  return {
    totalRuns,
    averageScore: Number((sums.score / totalRuns).toFixed(2)),
    averageAnswerCorrectness: Number(
      (sums.answerCorrectness / totalRuns).toFixed(2),
    ),
    averageFaithfulness: Number((sums.faithfulness / totalRuns).toFixed(2)),
    averageRelevance: Number((sums.relevance / totalRuns).toFixed(2)),
    averageCompleteness: Number((sums.completeness / totalRuns).toFixed(2)),
  };
};
