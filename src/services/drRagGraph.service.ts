import { StateGraph, Annotation, START, END, Send } from "@langchain/langgraph";
import { AskQuestionRequest } from "../types/api.types";
import {
  AnswerGroundingCheck,
  EvaluatedChunk,
  RagAnswerResult,
} from "../types/rag.types";
import { RAG_CONFIG } from "../config/rag.config";
import { resolveChatScope } from "./chatScope.service";
import { searchRelevantChunks } from "./vector.service";
import {
  calculateAverageRelevance,
  evaluateRetrievedChunks,
} from "./relevance.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import {
  generateAnswerFromContext,
  generateEntityExtractionAnswer,
} from "./groq.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";
import { buildCapabilityAnswer } from "./metaAnswer.service";
import {
  classifyQuestionIntent,
  SemanticQuestionIntent,
} from "./intentClassifier.service";
import { rewriteAcademicQuery } from "./queryRewrite.service";
import { selectContextChunksForQuestion } from "./sectionContext.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import {
  AnswerProfileDetection,
  detectAnswerProfile,
  isPracticalApplicationQuestion,
  shouldTreatAsSummaryIntent,
} from "../utils/answerProfile";
import {
  DR_RAG_MODE,
  SELECTION_STRATEGY,
  DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK,
  MAX_DYNAMIC_QUERIES,
  DOCUMENT_PROCESSING_MESSAGE,
  DynamicCandidateGroup,
  buildContext,
  buildExpandedRetrievalQuery,
  dedupeChunks,
  getRetrievedSections,
  hasSufficientStageOneEvidence,
  interleaveStaticAndDynamicChunks,
  retrieveStageOneChunks,
  selectContextLimit,
  selectDynamicChunksCfs,
  selectStaticChunks,
  toSources,
} from "./drRag.service";

type ChatScopeResolution = Awaited<ReturnType<typeof resolveChatScope>>;
type AnswerStyleDetection = ReturnType<typeof detectAnswerStyle>;

type DrRagFallbackReason =
  | "document_processing"
  | "no_relevant_chunks_found"
  | "out_of_scope"
  | "empty_answer"
  | "grounding_failed";

export const DrRagState = Annotation.Root({
  // Inputs
  userId: Annotation<string>(),
  payload: Annotation<AskQuestionRequest>(),
  startedAt: Annotation<number>(),

  // Prepared context
  chatScope: Annotation<ChatScopeResolution>(),
  intent: Annotation<SemanticQuestionIntent>(),
  answerProfile: Annotation<AnswerProfileDetection>(),
  answerStyle: Annotation<AnswerStyleDetection>(),
  allowIllustrativeExamples: Annotation<boolean>(),
  stageOneQuery: Annotation<string>(),

  // Stage one (static-relevant) retrieval
  stageOneChunks: Annotation<EvaluatedChunk[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  staticChunks: Annotation<EvaluatedChunk[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),

  // Stage two (dynamic-relevant) fan-out. Each parallel QDC branch writes a
  // single-element array; the reducer joins them before selection runs.
  dynamicGroups: Annotation<DynamicCandidateGroup[]>({
    reducer: (accumulated, next) => accumulated.concat(next),
    default: () => [],
  }),

  // Selection
  stageTwoChunks: Annotation<EvaluatedChunk[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  dynamicChunks: Annotation<EvaluatedChunk[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  answerChunks: Annotation<EvaluatedChunk[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  usedSectionExpansion: Annotation<boolean>(),
  selectedSectionTitle: Annotation<string | undefined>(),

  // Generation & grading
  context: Annotation<string>(),
  answer: Annotation<string>(),
  grounding: Annotation<AnswerGroundingCheck | undefined>(),
  fallbackReason: Annotation<DrRagFallbackReason | undefined>(),

  // Output
  result: Annotation<RagAnswerResult>(),
});

type DrRagStateType = typeof DrRagState.State;

type QdcBranchInput = {
  seed: EvaluatedChunk;
  question: string;
  vectorFilters: ChatScopeResolution["vectorFilters"];
};

// Node: resolve scope, classify intent, detect answer profile/style, rewrite query
const prepareNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  const chatScope = await resolveChatScope(state.userId, state.payload);

  if (chatScope.hasProcessingDocument) {
    return { chatScope, fallbackReason: "document_processing" };
  }

  const intentClassification = await classifyQuestionIntent(
    state.payload.question,
  );
  const allowIllustrativeExamples = isPracticalApplicationQuestion(
    state.payload.question,
  );
  const classifiedIntent =
    allowIllustrativeExamples && intentClassification.intent === "extraction"
      ? "qa"
      : intentClassification.intent;
  const answerProfile = detectAnswerProfile(
    state.payload.question,
    classifiedIntent,
  );
  const intent = shouldTreatAsSummaryIntent(classifiedIntent, answerProfile)
    ? ("summary" as const)
    : classifiedIntent;
  const answerStyle = detectAnswerStyle(state.payload.question);

  // Meta questions skip retrieval entirely — see routeAfterPrepare.
  if (intent === "meta") {
    return {
      chatScope,
      intent,
      answerProfile,
      answerStyle,
      allowIllustrativeExamples,
      stageOneQuery: state.payload.question,
      answer: buildCapabilityAnswer(answerStyle.language),
    };
  }

  const rewrittenQuery =
    intent === "extraction"
      ? state.payload.question
      : await rewriteAcademicQuery(state.payload.question, { intent });

  return {
    chatScope,
    intent,
    answerProfile,
    answerStyle,
    allowIllustrativeExamples,
    stageOneQuery: rewrittenQuery || state.payload.question,
  };
};

// Node: first-retrieval stage — static-relevant chunks via similarity matching
const stageOneRetrieveNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  const stageOneRawChunks = await retrieveStageOneChunks(
    state.stageOneQuery,
    state.chatScope.vectorFilters,
    {
      isMultiDocumentScope: state.chatScope.isMultiDocumentScope,
      documentIds: state.chatScope.documentIds,
      wantsDetailedAnswer: state.answerProfile.wantsDetailedAnswer,
    },
  );
  const stageOneChunks = evaluateRetrievedChunks(
    `${state.payload.question} ${state.stageOneQuery}`,
    dedupeChunks(stageOneRawChunks),
    RAG_CONFIG.relevanceThreshold,
  );
  const hasStageOneEvidence = hasSufficientStageOneEvidence(
    state.payload.question,
    stageOneChunks,
  );
  const staticChunks = selectStaticChunks(stageOneChunks, {
    wantsDetailedAnswer: state.answerProfile.wantsDetailedAnswer,
    isMultiDocumentScope: state.chatScope.isMultiDocumentScope,
    wantsShortAnswer: state.answerStyle.wantsShortAnswer,
  });

  let fallbackReason: DrRagFallbackReason | undefined;
  if (stageOneChunks.length === 0) {
    fallbackReason = "no_relevant_chunks_found";
  } else if (!hasStageOneEvidence || staticChunks.length === 0) {
    fallbackReason = "out_of_scope";
  }

  return { stageOneChunks, staticChunks, fallbackReason };
};

// Node: second-retrieval stage — one parallel branch per static seed (QDC)
const qdcRetrieveNode = async (
  branch: QdcBranchInput,
): Promise<Partial<DrRagStateType>> => {
  const query = buildExpandedRetrievalQuery(branch.question, branch.seed);
  const rawCandidates = await searchRelevantChunks(
    query,
    branch.vectorFilters,
    DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK,
  );
  const candidates = evaluateRetrievedChunks(
    `${branch.question} ${query}`,
    dedupeChunks(rawCandidates).filter((chunk) => chunk.id !== branch.seed.id),
    RAG_CONFIG.relevanceThreshold,
  );

  return { dynamicGroups: [{ seed: branch.seed, query, candidates }] };
};

// Node: CFS selection + interleave + optional section expansion
const cfsSelectNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  const stageTwoChunks = dedupeChunks(
    state.dynamicGroups.flatMap((group) => group.candidates),
  );
  const dynamicChunks = selectDynamicChunksCfs(
    state.staticChunks,
    state.dynamicGroups,
  );
  const contextLimit = selectContextLimit(
    state.intent,
    state.answerStyle.wantsShortAnswer,
    state.answerProfile.wantsDetailedAnswer,
  );
  const selectedBeforeExpansion = interleaveStaticAndDynamicChunks(
    state.staticChunks,
    dynamicChunks,
    contextLimit,
  );
  const contextSelection = state.answerProfile.wantsDetailedAnswer
    ? await selectContextChunksForQuestion(
        state.payload.question,
        selectedBeforeExpansion,
        { maxChunks: contextLimit },
      )
    : {
        chunks: selectedBeforeExpansion,
        usedSectionExpansion: false,
        selectedSectionTitle: undefined,
      };
  const answerChunks = evaluateRetrievedChunks(
    `${state.payload.question} ${state.stageOneQuery}`,
    contextSelection.chunks,
    RAG_CONFIG.relevanceThreshold,
  ).slice(0, contextLimit);

  return {
    stageTwoChunks,
    dynamicChunks,
    answerChunks,
    usedSectionExpansion: contextSelection.usedSectionExpansion,
    selectedSectionTitle: contextSelection.selectedSectionTitle,
  };
};

// Node: single generation call over the concatenated context
const generateNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  const context = buildContext(state.answerChunks);
  const answer =
    state.intent === "extraction"
      ? await generateEntityExtractionAnswer(state.payload.question, context)
      : await generateAnswerFromContext(state.payload.question, context, false, {
          intent: state.intent,
          answerProfile: state.answerProfile.profile,
          subject: state.chatScope.subject,
          documentTitle: state.chatScope.documentTitle,
          allowIllustrativeExamples: state.allowIllustrativeExamples,
        });

  return { context, answer };
};

// Node: deterministic grounding gate before finalizing
const gradeGroundingNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  const grounding = await checkAnswerGrounding(state.answer, state.context, {
    intent: state.intent,
    isMultiDocument: state.chatScope.isMultiDocumentScope,
    allowIllustrativeExamples: state.allowIllustrativeExamples,
  });

  let fallbackReason: DrRagFallbackReason | undefined;
  if (!state.answer) {
    fallbackReason = "empty_answer";
  } else if (!grounding.isGrounded) {
    fallbackReason = "grounding_failed";
  }

  return { grounding, fallbackReason };
};

// Node: unified graceful-failure path for all fallback reasons
const fallbackNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  if (state.fallbackReason === "document_processing") {
    return { answer: DOCUMENT_PROCESSING_MESSAGE };
  }

  const isPostGeneration =
    state.fallbackReason === "empty_answer" ||
    state.fallbackReason === "grounding_failed";
  const allEvaluatedChunks = dedupeChunks([
    ...state.stageOneChunks,
    ...state.stageTwoChunks,
  ]);
  const relevantChunksCount = isPostGeneration
    ? allEvaluatedChunks.filter((chunk) => chunk.isRelevant).length
    : 0;
  const answer = await generateFallbackAnswer({
    question: state.payload.question,
    language: state.answerStyle.language,
    retrievedChunksCount: allEvaluatedChunks.length,
    relevantChunksCount,
    averageRelevanceScore: calculateAverageRelevance(allEvaluatedChunks),
    documentTitle:
      state.chatScope.documentTitle ||
      (isPostGeneration
        ? state.answerChunks[0]?.metadata.title
        : undefined),
    subject: state.chatScope.subject,
    reason: state.fallbackReason || "no_relevant_chunks_found",
    answerProfile: state.answerProfile?.profile,
  });

  return { answer };
};

// Node: assemble the RagAnswerResult from graph state
const finalizeNode = async (
  state: DrRagStateType,
): Promise<Partial<DrRagStateType>> => {
  if (state.fallbackReason === "document_processing") {
    return {
      result: {
        answer: state.answer,
        mode: DR_RAG_MODE,
        originalQuestion: state.payload.question,
        sources: [],
        evaluation: {
          retrievedChunksCount: 0,
          relevantChunksCount: 0,
          averageRelevanceScore: 0,
          isGrounded: false,
          confidenceScore: 0,
          responseTimeMs: Date.now() - state.startedAt,
          stageOneChunksCount: 0,
          stageTwoChunksCount: 0,
          selectedStaticChunksCount: 0,
          selectedDynamicChunksCount: 0,
          dynamicRetrievalAttempted: false,
          selectionStrategy: SELECTION_STRATEGY,
          retrievalQueries: [],
          fallbackGenerated: true,
          fallbackReason: state.fallbackReason,
          retrievedSections: [],
          usedSectionExpansion: false,
          contextChunksUsed: 0,
        },
      },
    };
  }

  if (state.intent === "meta") {
    return {
      result: {
        answer: state.answer,
        mode: DR_RAG_MODE,
        originalQuestion: state.payload.question,
        sources: [],
        evaluation: {
          retrievedChunksCount: 0,
          relevantChunksCount: 0,
          averageRelevanceScore: 0,
          isGrounded: true,
          confidenceScore: 1,
          responseTimeMs: Date.now() - state.startedAt,
          stageOneChunksCount: 0,
          stageTwoChunksCount: 0,
          selectedStaticChunksCount: 0,
          selectedDynamicChunksCount: 0,
          dynamicRetrievalAttempted: false,
          selectionStrategy: SELECTION_STRATEGY,
          retrievalQueries: [],
          fallbackGenerated: false,
          detectedIntent: state.intent,
          answerProfile: state.answerProfile.profile,
          retrievedSections: [],
          usedSectionExpansion: false,
          contextChunksUsed: 0,
        },
      },
    };
  }

  const isFallback = Boolean(state.fallbackReason);
  const isPreGenerationFallback =
    state.fallbackReason === "no_relevant_chunks_found" ||
    state.fallbackReason === "out_of_scope";
  const allEvaluatedChunks = dedupeChunks([
    ...state.stageOneChunks,
    ...state.stageTwoChunks,
  ]);
  const relevantChunks = allEvaluatedChunks.filter((chunk) => chunk.isRelevant);

  return {
    result: {
      answer: state.answer,
      mode: DR_RAG_MODE,
      originalQuestion: state.payload.question,
      rewrittenQuery: state.stageOneQuery,
      sources: isPreGenerationFallback ? [] : toSources(state.answerChunks),
      evaluation: {
        retrievedChunksCount: allEvaluatedChunks.length,
        relevantChunksCount: isPreGenerationFallback
          ? 0
          : relevantChunks.length,
        averageRelevanceScore: calculateAverageRelevance(allEvaluatedChunks),
        isGrounded: isFallback ? false : state.grounding?.isGrounded ?? false,
        confidenceScore: state.grounding?.confidenceScore ?? 0,
        responseTimeMs: Date.now() - state.startedAt,
        stageOneChunksCount: state.stageOneChunks.length,
        stageTwoChunksCount: state.stageTwoChunks.length,
        selectedStaticChunksCount: isPreGenerationFallback
          ? 0
          : state.staticChunks.length,
        selectedDynamicChunksCount: isPreGenerationFallback
          ? 0
          : state.dynamicChunks.length,
        dynamicRetrievalAttempted: state.dynamicGroups.length > 0,
        selectionStrategy: SELECTION_STRATEGY,
        retrievalQueries: [
          state.stageOneQuery,
          ...state.dynamicGroups.map((group) => group.query),
        ],
        relevanceThreshold: RAG_CONFIG.relevanceThreshold,
        detectedIntent: state.intent,
        answerProfile: state.answerProfile.profile,
        usedSectionExpansion: state.usedSectionExpansion ?? false,
        selectedSectionTitle: state.selectedSectionTitle,
        contextChunksUsed: isPreGenerationFallback
          ? 0
          : state.answerChunks.length,
        retrievedSections: isPreGenerationFallback
          ? []
          : getRetrievedSections(allEvaluatedChunks),
        warning: state.grounding?.warning,
        fallbackGenerated: isFallback,
        fallbackReason: state.fallbackReason,
      },
    },
  };
};

const routeAfterPrepare = (
  state: DrRagStateType,
): "fallback" | "finalize" | "stageOneRetrieve" => {
  if (state.fallbackReason) {
    return "fallback";
  }
  if (state.intent === "meta") {
    return "finalize";
  }
  return "stageOneRetrieve";
};

// The DR-RAG fan-out: one Send per static seed runs qdcRetrieve branches in
// parallel within a single superstep; their writes join via the
// dynamicGroups reducer before cfsSelect executes.
const routeAfterStageOne = (
  state: DrRagStateType,
): "fallback" | Send[] => {
  if (state.fallbackReason) {
    return "fallback";
  }

  return state.staticChunks
    .slice(0, MAX_DYNAMIC_QUERIES)
    .map(
      (seed) =>
        new Send("qdcRetrieve", {
          seed,
          question: state.payload.question,
          vectorFilters: state.chatScope.vectorFilters,
        } satisfies QdcBranchInput),
    );
};

const routeAfterGrounding = (state: DrRagStateType): "fallback" | "finalize" =>
  state.fallbackReason ? "fallback" : "finalize";

let compiledDrRagGraph: ReturnType<typeof buildDrRagGraph> | undefined;

const buildDrRagGraph = () =>
  new StateGraph(DrRagState)
    .addNode("prepare", prepareNode)
    .addNode(
      "qdcRetrieve",
      qdcRetrieveNode as unknown as (
        state: DrRagStateType,
      ) => Promise<Partial<DrRagStateType>>,
    )
    .addNode("stageOneRetrieve", stageOneRetrieveNode)
    .addNode("cfsSelect", cfsSelectNode)
    .addNode("generate", generateNode)
    .addNode("gradeGrounding", gradeGroundingNode)
    .addNode("fallback", fallbackNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "prepare")
    .addConditionalEdges("prepare", routeAfterPrepare, [
      "stageOneRetrieve",
      "fallback",
      "finalize",
    ])
    .addConditionalEdges("stageOneRetrieve", routeAfterStageOne, [
      "qdcRetrieve",
      "fallback",
    ])
    .addEdge("qdcRetrieve", "cfsSelect")
    .addEdge("cfsSelect", "generate")
    .addEdge("generate", "gradeGrounding")
    .addConditionalEdges("gradeGrounding", routeAfterGrounding, [
      "finalize",
      "fallback",
    ])
    .addEdge("fallback", "finalize")
    .addEdge("finalize", END)
    .compile();

export const compileDrRagGraph = () => {
  if (!compiledDrRagGraph) {
    compiledDrRagGraph = buildDrRagGraph();
  }

  return compiledDrRagGraph;
};

export const askQuestionWithDrRagGraph = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const graph = compileDrRagGraph();
  const finalState = await graph.invoke({
    userId,
    payload,
    startedAt: Date.now(),
  });

  return finalState.result;
};
