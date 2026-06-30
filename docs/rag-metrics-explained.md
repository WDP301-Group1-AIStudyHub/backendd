# DR-RAG Metrics Explained

This document describes the `evaluation` object returned by chat answers and
stored in `RagEvaluationLog`.

## Retrieval Counts

- `retrievedChunksCount`: total unique chunks evaluated across stage 1 and
  stage 2.
- `stageOneChunksCount`: unique static-relevant chunks retrieved from the
  original or lightly rewritten question.
- `stageTwoChunksCount`: unique dynamic-relevant candidates retrieved from
  expanded `question + static chunk` queries.
- `relevantChunksCount`: chunks marked relevant by the backend relevance
  evaluator.
- `averageRelevanceScore`: average `relevanceScore` across evaluated chunks.

## DR-RAG Selection

- `selectedStaticChunksCount`: static chunks kept for final context.
- `selectedDynamicChunksCount`: dynamic chunks selected by the CFS-style
  selector.
- `dynamicRetrievalAttempted`: true when at least one expanded query was run.
- `selectionStrategy`: currently always `cfs-heuristic`.
- `retrievalQueries`: stage 1 query followed by expanded stage 2 queries.

The V1 selector uses Pinecone score, lexical relevance, section/outline
metadata, and novelty. It does not call Groq repeatedly as a classifier.

## Grounding And Fallback

- `isGrounded`: whether Groq judged the final answer supported by context.
- `confidenceScore`: grounding confidence clamped to `[0, 1]`.
- `fallbackGenerated`: true when the system returns a safe fallback response.
- `fallbackReason`: examples include `no_relevant_chunks_found`,
  `empty_answer`, `grounding_failed`, and `document_processing`.
- `warning`: optional grounding or parser warning.

DR-RAG generates the answer once from the selected context. If the answer is
empty or ungrounded, the backend returns a safe fallback instead of switching to
another RAG mode.

## Answer Shape

- `detectedIntent`: semantic question intent such as `qa`, `summary`,
  `comparison`, `extraction`, or `list`.
- `answerProfile`: `brief`, `standard`, or `detailed`.
- `usedSectionExpansion`: true when section-aware neighbor expansion was used.
- `selectedSectionTitle`: selected section/outline label when available.
- `contextChunksUsed`: number of chunks sent to answer generation.
- `retrievedSections`: unique section labels seen in retrieved chunks.

## Latency

- `responseTimeMs`: time spent in the DR-RAG service before chat persistence.

It includes intent/profile detection, optional query rewrite, Pinecone
retrieval, relevance scoring, answer generation, and grounding check.
