import { AskQuestionRequest, ChatSource } from "../types/api.types";
import { EvaluatedChunk, RagAnswerResult } from "../types/rag.types";
import { RAG_CONFIG } from "../config/rag.config";
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
import {
  searchRelevantChunks,
  searchRelevantChunksPerDocument,
  RetrievedChunk,
} from "./vector.service";
import { resolveChatScope } from "./chatScope.service";
import { detectAnswerStyle } from "../utils/answerStyle";
import {
  detectAnswerProfile,
  isPracticalApplicationQuestion,
  shouldTreatAsSummaryIntent,
} from "../utils/answerProfile";
import { selectContextChunksForQuestion } from "./sectionContext.service";
import {
  classifyQuestionIntent,
  SemanticQuestionIntent,
} from "./intentClassifier.service";
import { generateFallbackAnswer } from "./fallbackAnswer.service";
import { buildCapabilityAnswer } from "./metaAnswer.service";

export const DR_RAG_MODE = "dr-rag" as const;
export const SELECTION_STRATEGY = "cfs-heuristic" as const;
const DEFAULT_STATIC_CHUNK_LIMIT = 4;
const DETAILED_STATIC_CHUNK_LIMIT = 6;
const MULTI_DOCUMENT_STATIC_CHUNK_LIMIT = 6;
export const DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK = 4;
export const MAX_DYNAMIC_QUERIES = 4;
const DEFAULT_CONTEXT_CHUNK_LIMIT = 8;
const FOCUSED_CONTEXT_CHUNK_LIMIT = 4;
const DETAILED_CONTEXT_CHUNK_LIMIT = 16;
const EXPANDED_QUERY_CONTENT_LIMIT = 700;
export const DOCUMENT_PROCESSING_MESSAGE =
  "Tài liệu đang được xử lý, vui lòng thử lại sau.";
export const DOCUMENT_EMPTY_MESSAGE =
  "Tài liệu không chứa nội dung có thể tìm kiếm (có thể là file PDF scan hoặc file rỗng). Vui lòng thử OCR hoặc tải lên bản văn bản.";

export type DynamicCandidateGroup = {
  seed: EvaluatedChunk;
  query: string;
  candidates: EvaluatedChunk[];
};

const normalizeTerms = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  );

const sectionKey = (chunk: EvaluatedChunk | RetrievedChunk): string =>
  [
    chunk.metadata.documentId,
    chunk.metadata.outlineNodeId ||
      chunk.metadata.outlinePath ||
      chunk.metadata.sectionTitle ||
      chunk.metadata.inferredSection ||
      chunk.metadata.section ||
      "",
  ].join(":");

export const chunkContentKey = (chunk: RetrievedChunk): string =>
  chunk.content.toLowerCase().replace(/\s+/g, " ").trim();

export const dedupeChunks = <T extends RetrievedChunk>(chunks: T[]): T[] => {
  const byId = new Map<string, T>();

  chunks.forEach((chunk) => {
    const existing = byId.get(chunk.id);
    const chunkScore = chunk.pineconeScore ?? 0;
    const existingScore = existing?.pineconeScore ?? 0;

    if (!existing || chunkScore > existingScore) {
      byId.set(chunk.id, chunk);
    }
  });

  // Also collapse identical passages that exist under different chunk ids
  // (the same document uploaded multiple times), so duplicated uploads
  // cannot fill the context window with copies of one passage.
  const byContent = new Map<string, T>();

  byId.forEach((chunk) => {
    const key = chunkContentKey(chunk);
    const existing = byContent.get(key);
    const chunkScore = chunk.pineconeScore ?? 0;
    const existingScore = existing?.pineconeScore ?? 0;

    if (!existing || chunkScore > existingScore) {
      byContent.set(key, chunk);
    }
  });

  return [...byContent.values()];
};

const rankChunks = (chunks: EvaluatedChunk[]): EvaluatedChunk[] =>
  [...chunks].sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }

    return (b.pineconeScore ?? 0) - (a.pineconeScore ?? 0);
  });

export const hasSufficientStageOneEvidence = (
  question: string,
  chunks: EvaluatedChunk[],
): boolean => {
  if (chunks.length === 0) {
    return false;
  }

  const questionTerms = normalizeTerms(question);
  const hasLexicalTopicOverlap = chunks.some((chunk) => {
    const chunkTerms = normalizeTerms(
      [
        chunk.content,
        chunk.metadata.title,
        chunk.metadata.subject,
        chunk.metadata.sectionTitle,
        chunk.metadata.heading,
      ]
        .filter(Boolean)
        .join(" "),
    );

    return [...questionTerms].some((term) => chunkTerms.has(term));
  });
  const topPineconeScore = Math.max(
    ...chunks.map((chunk) => chunk.pineconeScore ?? 0),
  );

  return (
    hasLexicalTopicOverlap || topPineconeScore >= RAG_CONFIG.outOfScopeThreshold
  );
};

export const selectStaticChunks = (
  chunks: EvaluatedChunk[],
  options: {
    wantsDetailedAnswer: boolean;
    isMultiDocumentScope: boolean;
    wantsShortAnswer: boolean;
    skipRelevanceFilter?: boolean;
  },
): EvaluatedChunk[] => {
  const maxChunks = options.wantsShortAnswer
    ? FOCUSED_CONTEXT_CHUNK_LIMIT
    : options.wantsDetailedAnswer
      ? DETAILED_STATIC_CHUNK_LIMIT
      : options.isMultiDocumentScope
        ? MULTI_DOCUMENT_STATIC_CHUNK_LIMIT
        : DEFAULT_STATIC_CHUNK_LIMIT;
  const relevant = options.skipRelevanceFilter
    ? chunks
    : chunks.filter(
        (chunk) =>
          chunk.isRelevant ||
          chunk.relevanceScore >= RAG_CONFIG.relevanceThreshold ||
          (chunk.pineconeScore ?? 0) >= RAG_CONFIG.pineconeRelevanceThreshold,
      );
  return rankChunks(relevant).slice(0, maxChunks);
};

const compactChunkText = (chunk: EvaluatedChunk): string =>
  chunk.content.length > EXPANDED_QUERY_CONTENT_LIMIT
    ? `${chunk.content.slice(0, EXPANDED_QUERY_CONTENT_LIMIT)}...`
    : chunk.content;

export const buildExpandedRetrievalQuery = (
  question: string,
  chunk: EvaluatedChunk,
): string => {
  const section =
    chunk.metadata.outlinePath ||
    chunk.metadata.sectionTitle ||
    chunk.metadata.heading ||
    chunk.metadata.inferredSection ||
    chunk.metadata.section ||
    "General Content";

  return [
    question,
    `Document: ${chunk.metadata.title}`,
    `Section: ${section}`,
    `Known context: ${compactChunkText(chunk)}`,
  ].join("\n");
};

const hasNovelInformation = (
  candidate: EvaluatedChunk,
  selected: EvaluatedChunk[],
): boolean => {
  if (selected.length === 0) {
    return true;
  }

  const selectedIds = new Set(selected.map((chunk) => chunk.id));
  if (selectedIds.has(candidate.id)) {
    return false;
  }

  const selectedSectionKeys = new Set(selected.map(sectionKey));
  if (!selectedSectionKeys.has(sectionKey(candidate))) {
    return true;
  }

  const candidateTerms = normalizeTerms(candidate.content);
  if (candidateTerms.size === 0) {
    return false;
  }

  const selectedTerms = normalizeTerms(
    selected.map((chunk) => chunk.content).join("\n"),
  );
  const novelTerms = [...candidateTerms].filter(
    (term) => !selectedTerms.has(term),
  );
  const noveltyRatio = novelTerms.length / candidateTerms.size;

  return noveltyRatio >= 0.18;
};

const isDynamicCandidateUseful = (
  candidate: EvaluatedChunk,
  selected: EvaluatedChunk[],
): boolean => {
  const passesRelevance =
    candidate.relevanceScore >= RAG_CONFIG.relevanceThreshold ||
    (candidate.pineconeScore ?? 0) >= RAG_CONFIG.pineconeRelevanceThreshold;

  return passesRelevance && hasNovelInformation(candidate, selected);
};

export const selectDynamicChunksCfs = (
  staticChunks: EvaluatedChunk[],
  dynamicGroups: DynamicCandidateGroup[],
): EvaluatedChunk[] => {
  const selected: EvaluatedChunk[] = [...staticChunks];
  const selectedDynamicChunks: EvaluatedChunk[] = [];

  for (const staticChunk of staticChunks) {
    const group = dynamicGroups.find((item) => item.seed.id === staticChunk.id);
    const candidates = rankChunks(group?.candidates || []);
    const selectedCandidate = candidates.find((candidate) =>
      isDynamicCandidateUseful(candidate, selected),
    );

    if (selectedCandidate) {
      selected.push(selectedCandidate);
      selectedDynamicChunks.push(selectedCandidate);
    }
  }

  return selectedDynamicChunks;
};

export const interleaveStaticAndDynamicChunks = (
  staticChunks: EvaluatedChunk[],
  dynamicChunks: EvaluatedChunk[],
  maxChunks: number,
): EvaluatedChunk[] => {
  const dynamicBySection = new Map<string, EvaluatedChunk[]>();

  dynamicChunks.forEach((chunk) => {
    const key = sectionKey(chunk);
    dynamicBySection.set(key, [...(dynamicBySection.get(key) || []), chunk]);
  });

  const selected: EvaluatedChunk[] = [];

  for (const staticChunk of staticChunks) {
    selected.push(staticChunk);

    const sameSectionDynamics =
      dynamicBySection.get(sectionKey(staticChunk)) || [];
    const dynamic =
      sameSectionDynamics[0] ||
      dynamicChunks.find(
        (chunk) => !selected.some((item) => item.id === chunk.id),
      );

    if (dynamic) {
      selected.push(dynamic);
    }
  }

  return dedupeChunks(selected).slice(0, maxChunks);
};

export const buildContext = (chunks: EvaluatedChunk[]): string =>
  chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] Document: ${chunk.metadata.title}${
          chunk.metadata.sectionTitle
            ? `, section ${chunk.metadata.sectionTitle}`
            : ""
        }, chunk ${chunk.metadata.chunkIndex}\n${chunk.content}`,
    )
    .join("\n\n");

export const toSources = (
  chunks: EvaluatedChunk[],
  citations?: Map<string, number>,
): ChatSource[] =>
  chunks.map((chunk) => {
    const key = chunkContentKey(chunk);
    const citationId = citations?.get(key);
    return {
      documentId: chunk.metadata.documentId,
      title: chunk.metadata.title,
      chunkIndex: chunk.metadata.chunkIndex,
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
      ...(citationId !== undefined ? { citationId } : {}),
    };
  });

export const getRetrievedSections = (chunks: EvaluatedChunk[]): string[] => [
  ...new Set(
    chunks
      .map(
        (chunk) =>
          chunk.metadata.sectionTitle ||
          chunk.metadata.inferredSection ||
          chunk.metadata.section ||
          "",
      )
      .filter(Boolean),
  ),
];

const buildProcessingResult = (
  question: string,
  startedAt: number,
): RagAnswerResult => ({
  answer: DOCUMENT_PROCESSING_MESSAGE,
  mode: DR_RAG_MODE,
  originalQuestion: question,
  sources: [],
  evaluation: {
    retrievedChunksCount: 0,
    relevantChunksCount: 0,
    averageRelevanceScore: 0,
    isGrounded: false,
    confidenceScore: 0,
    responseTimeMs: Date.now() - startedAt,
    stageOneChunksCount: 0,
    stageTwoChunksCount: 0,
    selectedStaticChunksCount: 0,
    selectedDynamicChunksCount: 0,
    dynamicRetrievalAttempted: false,
    selectionStrategy: SELECTION_STRATEGY,
    retrievalQueries: [],
    fallbackGenerated: true,
    fallbackReason: "document_processing",
    retrievedSections: [],
    usedSectionExpansion: false,
    contextChunksUsed: 0,
  },
});

const buildEmptyDocumentResult = (
  question: string,
  startedAt: number,
  titles: string[],
): RagAnswerResult => {
  const fileNames = titles.join(", ");
  const answer = titles.length === 1
    ? `"${fileNames}" has no readable text — it looks like a scanned PDF or empty file, so there is nothing to search. Try running OCR or uploading a text-based copy.`
    : `The following documents have no readable text: "${fileNames}" — they look like scanned PDFs or empty files, so there is nothing to search. Try running OCR or uploading text-based copies.`;

  return {
    answer,
    mode: DR_RAG_MODE,
    originalQuestion: question,
    sources: [],
    evaluation: {
      retrievedChunksCount: 0,
      relevantChunksCount: 0,
      averageRelevanceScore: 0,
      isGrounded: false,
      confidenceScore: 0,
      responseTimeMs: Date.now() - startedAt,
      stageOneChunksCount: 0,
      stageTwoChunksCount: 0,
      selectedStaticChunksCount: 0,
      selectedDynamicChunksCount: 0,
      dynamicRetrievalAttempted: false,
      selectionStrategy: SELECTION_STRATEGY,
      retrievalQueries: [],
      fallbackGenerated: true,
      fallbackReason: "document_empty",
      retrievedSections: [],
      usedSectionExpansion: false,
      contextChunksUsed: 0,
    },
  };
};

export const selectContextLimit = (
  intent: SemanticQuestionIntent,
  wantsShortAnswer: boolean,
  wantsDetailedAnswer: boolean,
): number => {
  if (intent === "extraction" || wantsShortAnswer) {
    return FOCUSED_CONTEXT_CHUNK_LIMIT;
  }

  return wantsDetailedAnswer
    ? DETAILED_CONTEXT_CHUNK_LIMIT
    : DEFAULT_CONTEXT_CHUNK_LIMIT;
};

export const retrieveStageOneChunks = async (
  query: string,
  filters: Parameters<typeof searchRelevantChunks>[1],
  options: {
    isMultiDocumentScope: boolean;
    documentIds?: string[];
    wantsDetailedAnswer: boolean;
  },
): Promise<RetrievedChunk[]> => {
  if (options.isMultiDocumentScope && options.documentIds?.length) {
    const perDocumentTopK = options.wantsDetailedAnswer ? 3 : 2;

    return searchRelevantChunksPerDocument(query, filters, perDocumentTopK);
  }

  return searchRelevantChunks(
    query,
    filters,
    options.wantsDetailedAnswer
      ? DETAILED_STATIC_CHUNK_LIMIT
      : DEFAULT_STATIC_CHUNK_LIMIT,
  );
};

export type DrRagRetrievalResult = {
  chunks: EvaluatedChunk[];
  sources: ChatSource[];
  stageOneCount: number;
  stageTwoCount: number;
  retrievalQueries: string[];
};

// Retrieval-only DR-RAG (stage one + QDC fan-out + CFS selection) with no LLM
// calls, for callers that synthesize the answer themselves — e.g. the agent
// loop, where the model supplies an already-focused query per tool call.
export const retrieveDrRagContext = async (
  query: string,
  filters: Parameters<typeof searchRelevantChunks>[1],
  options: { contextLimit?: number; skipGroundingGuard?: boolean } = {},
): Promise<DrRagRetrievalResult> => {
  const contextLimit = options.contextLimit ?? DEFAULT_CONTEXT_CHUNK_LIMIT;
  const stageOneRaw = await searchRelevantChunks(
    query,
    filters,
    DEFAULT_STATIC_CHUNK_LIMIT,
  );

  const stageOneChunks = evaluateRetrievedChunks(
    query,
    dedupeChunks(stageOneRaw),
    options.skipGroundingGuard ? 0 : RAG_CONFIG.relevanceThreshold,
  );

  const staticChunks = selectStaticChunks(stageOneChunks, {
    wantsDetailedAnswer: false,
    isMultiDocumentScope: false,
    wantsShortAnswer: false,
    skipRelevanceFilter: options.skipGroundingGuard,
  });

  if (
    !options.skipGroundingGuard &&
    (staticChunks.length === 0 ||
      !hasSufficientStageOneEvidence(query, stageOneChunks))
  ) {
    return {
      chunks: [],
      sources: [],
      stageOneCount: stageOneChunks.length,
      stageTwoCount: 0,
      retrievalQueries: [query],
    };
  }

  const seeds = staticChunks.slice(0, MAX_DYNAMIC_QUERIES);

  const expandedQueries = seeds.map((seed) =>
    buildExpandedRetrievalQuery(query, seed),
  );

  const stageTwoResults = await Promise.all(
    expandedQueries.map((expandedQuery) =>
      searchRelevantChunks(
        expandedQuery,
        filters,
        DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK,
      ),
    ),
  );

  const dynamicGroups = seeds.map((seed, index) => ({
    seed,
    query: expandedQueries[index],
    candidates: evaluateRetrievedChunks(
      `${query} ${expandedQueries[index]}`,
      dedupeChunks(stageTwoResults[index] || []).filter(
        (chunk) => chunk.id !== seed.id,
      ),
      RAG_CONFIG.relevanceThreshold,
    ),
  }));
  const dynamicChunks = selectDynamicChunksCfs(staticChunks, dynamicGroups);
  const selected = interleaveStaticAndDynamicChunks(
    staticChunks,
    dynamicChunks,
    contextLimit,
  );

  return {
    chunks: selected,
    sources: toSources(selected),
    stageOneCount: stageOneChunks.length,
    stageTwoCount: dedupeChunks(
      dynamicGroups.flatMap((group) => group.candidates),
    ).length,
    retrievalQueries: [query, ...expandedQueries],
  };
};

export const askQuestionWithDrRag = async (
  userId: string,
  payload: AskQuestionRequest,
): Promise<RagAnswerResult> => {
  const startedAt = Date.now();
  const chatScope = await resolveChatScope(userId, payload);

  if (chatScope.hasProcessingDocument) {
    return buildProcessingResult(payload.question, startedAt);
  }

  if (chatScope.emptyDocumentTitles && chatScope.emptyDocumentTitles.length > 0) {
    return buildEmptyDocumentResult(payload.question, startedAt, chatScope.emptyDocumentTitles);
  }

  const intentClassification = await classifyQuestionIntent(payload.question);
  const allowIllustrativeExamples = isPracticalApplicationQuestion(
    payload.question,
  );
  const classifiedIntent =
    allowIllustrativeExamples && intentClassification.intent === "extraction"
      ? "qa"
      : intentClassification.intent;
  const answerProfile = detectAnswerProfile(payload.question, classifiedIntent);
  const intent = shouldTreatAsSummaryIntent(classifiedIntent, answerProfile)
    ? "summary"
    : classifiedIntent;
  const answerStyle = detectAnswerStyle(payload.question);
  const wantsDetailedAnswer = answerProfile.wantsDetailedAnswer;

  // Meta questions are about the assistant, not the documents: retrieval can
  // only return the nearest-embedding passage, never the right answer.
  if (intent === "meta") {
    return {
      answer: buildCapabilityAnswer(answerStyle.language),
      mode: DR_RAG_MODE,
      originalQuestion: payload.question,
      sources: [],
      evaluation: {
        retrievedChunksCount: 0,
        relevantChunksCount: 0,
        averageRelevanceScore: 0,
        isGrounded: true,
        confidenceScore: 1,
        responseTimeMs: Date.now() - startedAt,
        stageOneChunksCount: 0,
        stageTwoChunksCount: 0,
        selectedStaticChunksCount: 0,
        selectedDynamicChunksCount: 0,
        dynamicRetrievalAttempted: false,
        selectionStrategy: SELECTION_STRATEGY,
        retrievalQueries: [],
        fallbackGenerated: false,
        detectedIntent: intent,
        answerProfile: answerProfile.profile,
        retrievedSections: [],
        usedSectionExpansion: false,
        contextChunksUsed: 0,
      },
    };
  }

  const rewrittenQuery =
    intent === "extraction"
      ? payload.question
      : await rewriteAcademicQuery(payload.question, { intent });
  const stageOneQuery = rewrittenQuery || payload.question;
  const stageOneRawChunks = await retrieveStageOneChunks(
    stageOneQuery,
    chatScope.vectorFilters,
    {
      isMultiDocumentScope: chatScope.isMultiDocumentScope,
      documentIds: chatScope.documentIds,
      wantsDetailedAnswer,
    },
  );
  const stageOneChunks = evaluateRetrievedChunks(
    `${payload.question} ${stageOneQuery}`,
    dedupeChunks(stageOneRawChunks),
    RAG_CONFIG.relevanceThreshold,
  );
  const hasStageOneEvidence = hasSufficientStageOneEvidence(
    payload.question,
    stageOneChunks,
  );
  const staticChunks = selectStaticChunks(stageOneChunks, {
    wantsDetailedAnswer,
    isMultiDocumentScope: chatScope.isMultiDocumentScope,
    wantsShortAnswer: answerStyle.wantsShortAnswer,
  });

  if (
    stageOneChunks.length === 0 ||
    !hasStageOneEvidence ||
    staticChunks.length === 0
  ) {
    const fallbackReason =
      stageOneChunks.length === 0 ? "no_relevant_chunks_found" : "out_of_scope";
    const averageRelevanceScore = calculateAverageRelevance(stageOneChunks);
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: stageOneChunks.length,
      relevantChunksCount: 0,
      averageRelevanceScore,
      documentTitle: chatScope.documentTitle,
      subject: chatScope.subject,
      reason: fallbackReason,
      answerProfile: answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      mode: DR_RAG_MODE,
      originalQuestion: payload.question,
      rewrittenQuery: stageOneQuery,
      sources: [],
      evaluation: {
        retrievedChunksCount: stageOneChunks.length,
        relevantChunksCount: 0,
        averageRelevanceScore,
        isGrounded: false,
        confidenceScore: 0,
        responseTimeMs: Date.now() - startedAt,
        stageOneChunksCount: stageOneChunks.length,
        stageTwoChunksCount: 0,
        selectedStaticChunksCount: 0,
        selectedDynamicChunksCount: 0,
        dynamicRetrievalAttempted: false,
        selectionStrategy: SELECTION_STRATEGY,
        retrievalQueries: [stageOneQuery],
        relevanceThreshold: RAG_CONFIG.relevanceThreshold,
        fallbackGenerated: true,
        fallbackReason,
        detectedIntent: intent,
        answerProfile: answerProfile.profile,
        usedSectionExpansion: false,
        contextChunksUsed: 0,
        retrievedSections: [],
      },
    };
  }

  const dynamicSeeds = staticChunks.slice(0, MAX_DYNAMIC_QUERIES);
  const expandedQueries = dynamicSeeds.map((chunk) =>
    buildExpandedRetrievalQuery(payload.question, chunk),
  );
  const stageTwoResults = await Promise.all(
    expandedQueries.map((query) =>
      searchRelevantChunks(
        query,
        chatScope.vectorFilters,
        DEFAULT_DYNAMIC_TOP_K_PER_STATIC_CHUNK,
      ),
    ),
  );
  const dynamicGroups = dynamicSeeds.map((seed, index) => ({
    seed,
    query: expandedQueries[index],
    candidates: evaluateRetrievedChunks(
      `${payload.question} ${expandedQueries[index]}`,
      dedupeChunks(stageTwoResults[index] || []).filter(
        (chunk) => chunk.id !== seed.id,
      ),
      RAG_CONFIG.relevanceThreshold,
    ),
  }));
  const stageTwoChunks = dedupeChunks(
    dynamicGroups.flatMap((group) => group.candidates),
  );
  const dynamicChunks = selectDynamicChunksCfs(staticChunks, dynamicGroups);
  const contextLimit = selectContextLimit(
    intent,
    answerStyle.wantsShortAnswer,
    wantsDetailedAnswer,
  );
  const selectedBeforeExpansion = interleaveStaticAndDynamicChunks(
    staticChunks,
    dynamicChunks,
    contextLimit,
  );
  const contextSelection = wantsDetailedAnswer
    ? await selectContextChunksForQuestion(
        payload.question,
        selectedBeforeExpansion,
        { maxChunks: contextLimit },
      )
    : {
        chunks: selectedBeforeExpansion,
        usedSectionExpansion: false,
        selectedSectionTitle: undefined,
      };
  const answerChunks = evaluateRetrievedChunks(
    `${payload.question} ${stageOneQuery}`,
    contextSelection.chunks,
    RAG_CONFIG.relevanceThreshold,
  ).slice(0, contextLimit);
  const allEvaluatedChunks = dedupeChunks([
    ...stageOneChunks,
    ...stageTwoChunks,
  ]);
  const relevantChunks = allEvaluatedChunks.filter((chunk) => chunk.isRelevant);
  const averageRelevanceScore = calculateAverageRelevance(allEvaluatedChunks);
  const context = buildContext(answerChunks);
  const answer =
    intent === "extraction"
      ? await generateEntityExtractionAnswer(payload.question, context)
      : await generateAnswerFromContext(payload.question, context, false, {
          intent,
          answerProfile: answerProfile.profile,
          subject: chatScope.subject,
          documentTitle: chatScope.documentTitle,
          allowIllustrativeExamples,
        });
  const grounding = await checkAnswerGrounding(answer, context, {
    intent,
    isMultiDocument: chatScope.isMultiDocumentScope,
    allowIllustrativeExamples,
  });
  const baseEvaluation = {
    retrievedChunksCount: allEvaluatedChunks.length,
    relevantChunksCount: relevantChunks.length,
    averageRelevanceScore,
    stageOneChunksCount: stageOneChunks.length,
    stageTwoChunksCount: stageTwoChunks.length,
    selectedStaticChunksCount: staticChunks.length,
    selectedDynamicChunksCount: dynamicChunks.length,
    dynamicRetrievalAttempted: expandedQueries.length > 0,
    selectionStrategy: SELECTION_STRATEGY,
    retrievalQueries: [stageOneQuery, ...expandedQueries],
    relevanceThreshold: RAG_CONFIG.relevanceThreshold,
    detectedIntent: intent,
    answerProfile: answerProfile.profile,
    usedSectionExpansion: contextSelection.usedSectionExpansion,
    selectedSectionTitle: contextSelection.selectedSectionTitle,
    contextChunksUsed: answerChunks.length,
    retrievedSections: getRetrievedSections(allEvaluatedChunks),
  };
  const sources = toSources(answerChunks);

  if (!answer || !grounding.isGrounded) {
    const fallbackReason = !answer ? "empty_answer" : "grounding_failed";
    const fallbackAnswer = await generateFallbackAnswer({
      question: payload.question,
      language: answerStyle.language,
      retrievedChunksCount: allEvaluatedChunks.length,
      relevantChunksCount: relevantChunks.length,
      averageRelevanceScore,
      documentTitle: chatScope.documentTitle || answerChunks[0]?.metadata.title,
      subject: chatScope.subject,
      reason: fallbackReason,
      answerProfile: answerProfile.profile,
    });

    return {
      answer: fallbackAnswer,
      mode: DR_RAG_MODE,
      originalQuestion: payload.question,
      rewrittenQuery: stageOneQuery,
      sources,
      evaluation: {
        ...baseEvaluation,
        isGrounded: false,
        confidenceScore: grounding.confidenceScore,
        responseTimeMs: Date.now() - startedAt,
        warning: grounding.warning,
        fallbackGenerated: true,
        fallbackReason,
      },
    };
  }

  return {
    answer,
    mode: DR_RAG_MODE,
    originalQuestion: payload.question,
    rewrittenQuery: stageOneQuery,
    sources,
    evaluation: {
      ...baseEvaluation,
      isGrounded: grounding.isGrounded,
      confidenceScore: grounding.confidenceScore,
      responseTimeMs: Date.now() - startedAt,
      warning: grounding.warning,
      fallbackGenerated: false,
    },
  };
};
