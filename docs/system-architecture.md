# AI Study Hub Backend System Architecture

AI Study Hub is an Express + TypeScript backend for uploading study documents
and asking grounded AI questions over uploaded content. The chat pipeline now
uses a single DR-RAG implementation; public `basic` and `corrective` RAG modes
are removed.

## Core Stack

| Technology | Role |
|---|---|
| Express + TypeScript | HTTP API and service layer |
| MongoDB + Mongoose | Users, documents, versions, chat history, evaluation logs, benchmarks |
| Cloudinary | Raw uploaded document storage |
| pdf-parse, mammoth, pptx2json, xlsx | Text extraction |
| LangChain text splitters | Chunking extracted text |
| Jina Embeddings | Document/query embeddings |
| Pinecone | Semantic vector search |
| Groq | Query rewriting, answer generation, grounding/evaluation |

## Main Flow

```text
User
-> Frontend/Mobile
-> Express API
-> Auth middleware
-> Document, Chat, Evaluation, Benchmark modules
-> MongoDB / Cloudinary / Jina / Pinecone / Groq
```

## Upload And Indexing

```text
POST /api/documents/upload or document version upload
-> extract text
-> detect headings/outline
-> split chunks with overlap
-> embed chunks with Jina
-> upsert vectors to Pinecone
-> persist document/version metadata in MongoDB
```

`src/services/rag.service.ts` now contains indexing/reindexing only.

## Chat DR-RAG

```text
POST /api/chat/ask
-> resolve chat scope
-> answer document-structure questions directly when applicable
-> classify intent and answer profile
-> Stage 1: retrieve static-relevant chunks
-> Stage 2: retrieve dynamic-relevant chunks using expanded queries
-> CFS-style heuristic selection
-> build final context
-> generate one answer from Groq
-> grounding check
-> safe fallback if ungrounded
-> persist chat history and evaluation log
```

The main answering entrypoint is `src/services/drRag.service.ts`.

## DR-RAG Components

- Stage 1 retrieval finds chunks directly relevant to the question.
- Expanded queries concatenate the question with each selected static chunk's
  title, section, and content preview.
- Stage 2 retrieval mines dynamic relevance that a single query can miss.
- `cfs-heuristic` approximates the paper's classifier-forward-selection by
  selecting dynamic chunks that pass relevance thresholds and add novel context.
- Grounding check prevents unsupported answers from reaching the user.

## Persistence

```text
MongoDB
  users
  documents
  document versions
  chat threads
  chat histories
  rag evaluation logs
  benchmark questions
  benchmark results

Pinecone
  chunk vectors + metadata

Cloudinary
  raw document files
```

## Benchmark

Benchmarks now evaluate the single production DR-RAG pipeline against an
expected answer. Results store one answer and one evaluation score set:
correctness, faithfulness, relevance, completeness, and overall score.
