import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { StudyDocument } from "../models/document.model";
import { DocumentVersion } from "../modules/documentVersions/documentVersion.model";
import { Subject } from "../models/subject.model";
import { AskQuestionRequest, ChatSource } from "../types/api.types";
import {
  RagAnswerResult,
  EvaluatedChunk,
  DrRagSelectionStrategy,
} from "../types/rag.types";
import { AppError } from "../middlewares/error.middleware";
import {
  generateAnswerFromContext,
  generateEntityExtractionAnswer,
} from "./gemini.service";
import { rewriteAcademicQuery } from "./queryRewrite.service";
import {
  calculateAverageRelevance,
  evaluateRetrievedChunks,
} from "./relevance.service";
import { checkAnswerGrounding } from "./answerCheck.service";
import { searchRelevantChunks } from "./vector.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import {
  detectAnswerProfile,
  shouldTreatAsSummaryIntent,
  AnswerProfileDetection,
} from "../utils/answerProfile";
import { selectContextChunksForQuestion } from "./sectionContext.service";
import { classifyQuestionIntent, SemanticQuestionIntent } from "./intentClassifier.service";
import { RAG_CONFIG } from "../config/rag.config";
import { generateFallbackAnswer } from "./fallbackAnswer.service";
import { buildCapabilityAnswer } from "./metaAnswer.service";
import { dedupeChunks } from "./drRag.service";
import {
  detectStructuralQuestion,
} from "../utils/documentStructure";
import { answerDocumentStructureQuestion } from "./documentStructureAnswer.service";

// Helpers
const getSubjectNameForUser = async (
  subjectId: string | undefined,
  userId: string,
): Promise<string | undefined> => {
  if (!subjectId) {
    return undefined;
  }
  const subject = await Subject.findOne({ _id: subjectId, ownerId: userId });
  if (!subject) {
    throw new AppError("Subject not found or does not belong to user", 400);
  }
  return subject.name;
};

// 1. Define the LangGraph State Annotation
export const AgentState = Annotation.Root({
  // Inputs
  userId: Annotation<string>(),
  payload: Annotation<AskQuestionRequest>(),
  startedAt: Annotation<number>(),
  
  // Pipeline variables
  documentTitle: Annotation<string | undefined>(),
  documentSubject: Annotation<string | undefined>(),
  subjectIdFilter: Annotation<string | undefined>(),
  intent: Annotation<SemanticQuestionIntent>(),
  answerProfile: Annotation<AnswerProfileDetection>(),
  rewrittenQuery: Annotation<string>(),
  stricterQuery: Annotation<string>(),
  
  // Retrieved data
  retrievedChunks: Annotation<EvaluatedChunk[]>(),
  relevantChunks: Annotation<EvaluatedChunk[]>(),
  
  // Context selection
  usedSectionExpansion: Annotation<boolean>(),
  selectedSectionTitle: Annotation<string | undefined>(),
  answerChunks: Annotation<EvaluatedChunk[]>(),
  
  // Final results
  answer: Annotation<string>(),
  sources: Annotation<ChatSource[]>(),
  grounded: Annotation<boolean>(),
  confidenceScore: Annotation<number>(),
  mode: Annotation<"basic" | "corrective">(),
  correctiveAttempted: Annotation<boolean>(),
  fallbackGenerated: Annotation<boolean>(),
  fallbackReason: Annotation<string>(),
  evaluationWarning: Annotation<string>(),
  stageOneChunksCount: Annotation<number | undefined>(),
  stageTwoChunksCount: Annotation<number | undefined>(),
  selectedStaticChunksCount: Annotation<number | undefined>(),
  selectedDynamicChunksCount: Annotation<number | undefined>(),
  dynamicRetrievalAttempted: Annotation<boolean | undefined>(),
  selectionStrategy: Annotation<DrRagSelectionStrategy | undefined>(),
  retrievalQueries: Annotation<string[] | undefined>(),

  // Per-stage wall-clock timings (benchmark instrumentation)
  retrievalLatencyMs: Annotation<number | undefined>(),
  generationLatencyMs: Annotation<number | undefined>(),
  groundingLatencyMs: Annotation<number | undefined>(),
});

// 2. Define the Graph Nodes

// Node A: Classify Intent & Rewrite Query
const classifyAndRewriteNode = async (state: typeof AgentState.State) => {
  const intentClassification = await classifyQuestionIntent(state.payload.question);
  const profile = detectAnswerProfile(state.payload.question, intentClassification.intent);
  
  const intent = shouldTreatAsSummaryIntent(intentClassification.intent, profile)
    ? ("summary" as const)
    : intentClassification.intent;

  // Only corrective retrieval ever uses the rewritten query (see
  // retrieveChunksNode / correctiveSearchNode); basic mode searches with the
  // original question, so rewriting there would burn an LLM call for nothing.
  let rewrittenQuery = state.payload.question;
  if (state.mode === "corrective" && intent !== "extraction" && intent !== "meta") {
    rewrittenQuery = await rewriteAcademicQuery(state.payload.question, {
      intent,
    });
  }

  // Load document / subject details
  let documentTitle: string | undefined;
  let documentSubject = state.payload.subject;
  let subjectIdFilter = state.payload.subjectId;

  if (state.payload.documentId) {
    const document = await StudyDocument.findOne({
      _id: state.payload.documentId,
      ownerId: state.userId,
      status: { $ne: "DELETED" },
    });

    if (document) {
      documentTitle = document.title;
      subjectIdFilter = document.subjectId?.toString();
      documentSubject =
        (await getSubjectNameForUser(subjectIdFilter, state.userId)) || documentSubject;
    }
  } else if (state.payload.subjectId) {
    documentSubject = await getSubjectNameForUser(state.payload.subjectId, state.userId);
  }

  return {
    intent,
    answerProfile: profile,
    rewrittenQuery,
    documentTitle,
    documentSubject,
    subjectIdFilter,
  };
};

// Node B0: Meta questions ("what can you do?", greetings) are about the
// assistant, not the documents — answer deterministically without retrieval.
const metaAnswerNode = async (state: typeof AgentState.State) => {
  const answerStyle = detectAnswerStyle(state.payload.question);

  return {
    answer: buildCapabilityAnswer(answerStyle.language),
    sources: [],
    retrievedChunks: [],
    relevantChunks: [],
    grounded: true,
    confidenceScore: 1,
    fallbackGenerated: false,
  };
};

// Node B: Document Structure Service (Direct Outline Counting Router)
const documentStructureNode = async (state: typeof AgentState.State) => {
  const result = await answerDocumentStructureQuestion(state.userId, state.payload);
  if (result) {
    return {
      answer: result.answer,
      mode: result.mode,
      sources: result.sources || [],
      grounded: result.evaluation?.isGrounded ?? true,
      confidenceScore: result.evaluation?.confidenceScore ?? 1,
      fallbackGenerated: result.evaluation?.fallbackGenerated ?? false,
      fallbackReason: result.evaluation?.fallbackReason ?? "",
    };
  }
  return {
    answer: "Could not retrieve document structure.",
  };
};

// Node C: Primary Vector Retrieval
const retrieveChunksNode = async (state: typeof AgentState.State) => {
  const retrievalStartedAt = Date.now();
  const wantsDetailed = state.answerProfile.wantsDetailedAnswer;
  const retrievalTopK = wantsDetailed ? 20 : 8; // matched to DETAILED_RETRIEVAL_TOP_K vs DEFAULT_RETRIEVAL_TOP_K in corrective RAG

  const rawChunks = await searchRelevantChunks(
    state.mode === "corrective" ? state.rewrittenQuery : state.payload.question,
    {
      userId: state.userId,
      documentId: state.payload.documentId,
      subject: state.payload.documentId ? undefined : state.payload.subject,
      subjectId: state.payload.documentId ? undefined : state.subjectIdFilter,
    },
    retrievalTopK,
  );
  // Collapse identical passages from duplicated document uploads so copies
  // cannot crowd out distinct content in the context window.
  const chunks = dedupeChunks(rawChunks);

  const evaluated = evaluateRetrievedChunks(
    state.mode === "corrective"
      ? `${state.payload.question} ${state.rewrittenQuery}`
      : state.payload.question,
    chunks,
    RAG_CONFIG.relevanceThreshold,
  );

  const relevant = evaluated.filter((chunk) => chunk.isRelevant);

  return {
    retrievedChunks: evaluated,
    relevantChunks: relevant,
    retrievalLatencyMs: Date.now() - retrievalStartedAt,
  };
};

// Node D: Corrective Retrieval Fallback (CRAG Node)
const correctiveSearchNode = async (state: typeof AgentState.State) => {
  const correctiveStartedAt = Date.now();
  const wantsDetailed = state.answerProfile.wantsDetailedAnswer;
  const retrievalTopK = wantsDetailed ? 20 : 8;

  const stricterQuery = await rewriteAcademicQuery(
    `${state.payload.question}\nPrevious rewritten query: ${state.rewrittenQuery}\nFocus on concrete keywords and definitions from the study document.`,
    { intent: state.intent, attempt: 2 },
  );

  const secondPassChunks = await searchRelevantChunks(
    stricterQuery,
    {
      userId: state.userId,
      documentId: state.payload.documentId,
      subject: state.payload.documentId ? undefined : state.payload.subject,
      subjectId: state.payload.documentId ? undefined : state.subjectIdFilter,
    },
    retrievalTopK,
  );

  const secondEvaluated = evaluateRetrievedChunks(
    `${state.payload.question} ${state.rewrittenQuery} ${stricterQuery}`,
    secondPassChunks,
    RAG_CONFIG.relevanceThreshold,
  );

  // Merge and deduplicate
  const allEvaluatedMap = new Map<string, EvaluatedChunk>();
  [...state.retrievedChunks, ...secondEvaluated].forEach((chunk) => {
    const existing = allEvaluatedMap.get(chunk.id);
    if (!existing || chunk.relevanceScore > existing.relevanceScore) {
      allEvaluatedMap.set(chunk.id, chunk);
    }
  });

  const mergedEvaluated = dedupeChunks([...allEvaluatedMap.values()]);
  const mergedRelevant = mergedEvaluated.filter((chunk) => chunk.isRelevant);

  return {
    stricterQuery,
    retrievedChunks: mergedEvaluated,
    relevantChunks: mergedRelevant,
    correctiveAttempted: true,
    // Both retrieval passes count toward the retrieval stage.
    retrievalLatencyMs:
      (state.retrievalLatencyMs || 0) + (Date.now() - correctiveStartedAt),
  };
};

// Node E: Format Context & Generate Answer & Grounding Validation
const generateAnswerNode = async (state: typeof AgentState.State) => {
  const chunksToUse = state.relevantChunks.length > 0 ? state.relevantChunks : state.retrievedChunks;
  const averageRelevanceScore = calculateAverageRelevance(state.retrievedChunks);

  if (chunksToUse.length === 0) {
    const fallbackReason = "no_relevant_chunks_found";
    const answerStyle = detectAnswerStyle(state.payload.question);
    const fallbackAnswer = await generateFallbackAnswer({
      question: state.payload.question,
      language: answerStyle.language,
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      documentTitle: state.documentTitle,
      subject: state.documentSubject,
      reason: fallbackReason,
      answerProfile: state.answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      sources: [],
      grounded: false,
      confidenceScore: 0,
      fallbackGenerated: true,
      fallbackReason,
    };
  }

  // Section Expansion
  const wantsDetailed = state.answerProfile.wantsDetailedAnswer;
  const contextSelection = wantsDetailed
    ? await selectContextChunksForQuestion(state.payload.question, chunksToUse, {
        maxChunks: 16, // DETAILED_CONTEXT_CHUNK_LIMIT
      })
    : {
        chunks: state.mode === "corrective" ? state.relevantChunks : state.retrievedChunks,
        usedSectionExpansion: false,
        selectedSectionTitle: undefined,
      };

  const evaluatedContextChunks = wantsDetailed
    ? evaluateRetrievedChunks(
        state.payload.question,
        contextSelection.chunks,
        RAG_CONFIG.relevanceThreshold,
      )
    : (contextSelection.chunks as EvaluatedChunk[]);

  // Dedup and Select Context
  const byId = new Map<string, EvaluatedChunk>();
  evaluatedContextChunks.forEach((c) => byId.set(c.id, c));
  const finalContextChunks = [...byId.values()];

  const maxChunksLimit =
    state.intent === "extraction" || detectAnswerStyle(state.payload.question).wantsShortAnswer
      ? 3 // FOCUSED_CONTEXT_CHUNK_LIMIT
      : wantsDetailed
        ? 16 // DETAILED_CONTEXT_CHUNK_LIMIT
        : 5; // DEFAULT_CONTEXT_CHUNK_LIMIT

  const answerChunks = [...finalContextChunks]
    .filter((chunk) => state.mode === "basic" || chunk.relevanceScore >= RAG_CONFIG.relevanceThreshold)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxChunksLimit);

  if (answerChunks.length === 0) {
    const fallbackReason = "retrieved_chunks_not_relevant_enough";
    const answerStyle = detectAnswerStyle(state.payload.question);
    const fallbackAnswer = await generateFallbackAnswer({
      question: state.payload.question,
      language: answerStyle.language,
      retrievedChunksCount: state.retrievedChunks.length,
      relevantChunksCount: state.relevantChunks.length,
      averageRelevanceScore,
      documentTitle: state.documentTitle || state.retrievedChunks[0]?.metadata.title,
      subject: state.documentSubject,
      reason: fallbackReason,
      answerProfile: state.answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      sources: [],
      grounded: false,
      confidenceScore: 0,
      fallbackGenerated: true,
      fallbackReason,
    };
  }

  // Format Context block
  const contextText = answerChunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}${
          chunk.metadata.sectionTitle
            ? `, section ${chunk.metadata.sectionTitle}`
            : ""
        }, chunk ${chunk.metadata.chunkIndex}\n${chunk.content}`,
    )
    .join("\n\n");

  // Call LLM
  let generationLatencyMs = 0;
  let groundingLatencyMs = 0;
  let stageStartedAt = Date.now();
  let answer =
    state.intent === "extraction"
      ? await generateEntityExtractionAnswer(state.payload.question, contextText)
      : await generateAnswerFromContext(state.payload.question, contextText, false, {
          intent: state.intent,
          answerProfile: state.answerProfile.profile,
        });
  generationLatencyMs += Date.now() - stageStartedAt;

  stageStartedAt = Date.now();
  let grounding = await checkAnswerGrounding(answer, contextText);
  groundingLatencyMs += Date.now() - stageStartedAt;

  // If not grounded, run strict mode query
  if (!grounding.isGrounded) {
    stageStartedAt = Date.now();
    answer =
      state.intent === "extraction"
        ? await generateEntityExtractionAnswer(state.payload.question, contextText)
        : await generateAnswerFromContext(state.payload.question, contextText, true, {
            intent: state.intent,
            answerProfile: state.answerProfile.profile,
          });
    generationLatencyMs += Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    grounding = await checkAnswerGrounding(answer, contextText);
    groundingLatencyMs += Date.now() - stageStartedAt;
  }

  // Map sources
  const sources: ChatSource[] = answerChunks.map((chunk) => ({
    documentId: chunk.metadata.documentId,
    title: chunk.metadata.title,
    chunkIndex: Number(chunk.metadata.chunkIndex),
    section: chunk.metadata.section,
    inferredSection: chunk.metadata.inferredSection,
    semanticSectionLabel: chunk.metadata.semanticSectionLabel,
    heading: chunk.metadata.heading,
    sectionTitle: chunk.metadata.sectionTitle,
    sectionIndex: chunk.metadata.sectionIndex,
    outlineNodeId: chunk.metadata.outlineNodeId,
    outlinePath: chunk.metadata.outlinePath,
    outlineLevel: chunk.metadata.outlineLevel,
    outlineType: chunk.metadata.outlineType,
    chapterOrdinal: chunk.metadata.chapterOrdinal,
    contentPreview:
      chunk.content.length > 220
        ? `${chunk.content.slice(0, 220)}...`
        : chunk.content,
    relevanceScore: chunk.relevanceScore,
  }));

  // Handle final fallback if still not grounded
  if (!answer || !grounding.isGrounded) {
    const fallbackReason = !answer ? "empty_answer" : "grounding_failed";
    const answerStyle = detectAnswerStyle(state.payload.question);
    const fallbackAnswer = await generateFallbackAnswer({
      question: state.payload.question,
      language: answerStyle.language,
      retrievedChunksCount: state.retrievedChunks.length,
      relevantChunksCount: state.relevantChunks.length,
      averageRelevanceScore,
      documentTitle: state.documentTitle || answerChunks[0]?.metadata.title,
      subject: state.documentSubject,
      reason: fallbackReason,
      answerProfile: state.answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      sources,
      grounded: false,
      confidenceScore: grounding.confidenceScore,
      fallbackGenerated: true,
      fallbackReason,
      evaluationWarning: grounding.warning,
      usedSectionExpansion: contextSelection.usedSectionExpansion,
      selectedSectionTitle: contextSelection.selectedSectionTitle,
      answerChunks: answerChunks,
      generationLatencyMs,
      groundingLatencyMs,
    };
  }

  return {
    answer,
    sources,
    grounded: grounding.isGrounded,
    confidenceScore: grounding.confidenceScore,
    fallbackGenerated: false,
    evaluationWarning: grounding.warning,
    usedSectionExpansion: contextSelection.usedSectionExpansion,
    selectedSectionTitle: contextSelection.selectedSectionTitle,
    answerChunks: answerChunks,
    generationLatencyMs,
    groundingLatencyMs,
  };
};

// 3. Define Conditional Edges

// Edge A: Route meta and structural check questions before retrieval
const routeStructureCheckEdge = (state: typeof AgentState.State) => {
  if (state.intent === "meta") {
    return "meta_answer";
  }
  const isStructural = detectStructuralQuestion(state.payload.question);
  if (isStructural) {
    return "document_structure";
  }
  return "retrieve_chunks";
};

// Edge B: Route corrective fallbacks (CRAG)
const routeCorrectiveEdge = (state: typeof AgentState.State) => {
  if (
    state.mode === "corrective" &&
    state.intent !== "extraction" &&
    state.relevantChunks.length < RAG_CONFIG.minRelevantChunks
  ) {
    return "corrective_search";
  }
  return "generate_answer";
};

// 4. Compile the Graph
export const compileStudyAgentGraph = () => {
  const workflow = new StateGraph(AgentState)
    .addNode("classify_and_rewrite", classifyAndRewriteNode)
    .addNode("meta_answer", metaAnswerNode)
    .addNode("document_structure", documentStructureNode)
    .addNode("retrieve_chunks", retrieveChunksNode)
    .addNode("corrective_search", correctiveSearchNode)
    .addNode("generate_answer", generateAnswerNode)

    // START edge to initial classification node
    .addEdge(START, "classify_and_rewrite")

    // Classify routes to meta answers, outline metadata, or similarity search
    .addConditionalEdges("classify_and_rewrite", routeStructureCheckEdge, {
      meta_answer: "meta_answer",
      document_structure: "document_structure",
      retrieve_chunks: "retrieve_chunks",
    })

    // Meta and document structure finish the graph directly
    .addEdge("meta_answer", END)
    .addEdge("document_structure", END)
    
    // Retrieve checks if corrective search is required
    .addConditionalEdges("retrieve_chunks", routeCorrectiveEdge, {
      corrective_search: "corrective_search",
      generate_answer: "generate_answer",
    })
    
    // Corrective search routes to final generator
    .addEdge("corrective_search", "generate_answer")
    
    // Generate answer finishes the graph
    .addEdge("generate_answer", END);

  return workflow.compile();
};
