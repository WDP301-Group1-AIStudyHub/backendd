# DR-RAG Flow

AI Study Hub now uses one RAG pipeline for chat: Dynamic-Relevant RAG
(DR-RAG), inspired by arXiv:2406.07348. The public `basic` and
`corrective` modes have been removed.

## Upload And Indexing

```text
Document upload
-> Format-specific text extraction
-> Heading/outline-aware chunking
-> Jina embeddings
-> Pinecone upsert with document, subject, section, and outline metadata
```

Indexing still lives in `src/services/rag.service.ts`. That service only
indexes/reindexes document chunks; answer generation now lives in
`src/services/drRag.service.ts`.

## Question Answering

```text
User question
-> Intent and answer-profile detection
-> Stage 1 retrieval: retrieve static-relevant chunks
-> Build expanded queries: question + static chunk metadata/content
-> Stage 2 retrieval: retrieve dynamic-relevant chunks
-> CFS-style heuristic selection
-> Groq answer generation from final context
-> Groq grounding check
-> Safe fallback if answer is empty or ungrounded
-> Chat history and RAG evaluation log
```

## DR-RAG Mapping

| Paper notation | AI Study Hub implementation |
|---|---|
| `q` | User question |
| `D` | User-scoped Pinecone namespace/filter |
| `d_stat` | Stage 1 static chunks |
| `q*` | Expanded query from `question + static chunk` |
| `d_dyn` | Stage 2 dynamic chunks |
| `Cnt` | Final context sent to Groq |
| `C` | V1 CFS heuristic selector, not a trained classifier |

## Selection Strategy

The V1 selector is `cfs-heuristic`:

- Keep the best static chunks from stage 1.
- For each static chunk, inspect dynamic candidates from the matching expanded
  query.
- Select the first candidate that passes relevance thresholds and adds novel
  information.
- Dedupe by vector id and avoid redundant same-section context.
- Fall back to static chunks if no useful dynamic chunk is found.

## Metrics

Each answer records:

- `stageOneChunksCount`
- `stageTwoChunksCount`
- `selectedStaticChunksCount`
- `selectedDynamicChunksCount`
- `dynamicRetrievalAttempted`
- `selectionStrategy`
- `retrievalQueries`
- standard relevance, grounding, fallback, and latency metrics

Tune `RELEVANCE_THRESHOLD`, `PINECONE_RELEVANCE_THRESHOLD`, and
`MIN_RELEVANT_CHUNKS` through environment variables.
