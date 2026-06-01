# AI Study Hub Backend System Architecture

This document describes the current backend architecture based on the source code in `src`.

## System Overview

AI Study Hub is an Express + TypeScript backend for uploading study documents and asking AI questions over uploaded content. The RAG behavior now focuses on Vietnamese educational document QA.

The backend is responsible for:

- authentication and protected APIs
- document upload and metadata management
- raw document storage in Cloudinary
- document text extraction
- text chunking with LangChain JS text splitters
- Jina embedding generation
- configurable relevance thresholds for Vietnamese RAG precision
- Pinecone semantic vector indexing and retrieval
- Basic RAG and Corrective RAG question answering
- Groq answer generation, query rewriting, and grounding checks
- chat history, evaluation logs, and benchmark results in MongoDB

## Tech Stack

| Technology | Role |
|---|---|
| Node.js | Runtime for the backend service |
| Express | HTTP API framework and route registration |
| TypeScript | Static typing for controllers, services, models, and API contracts |
| MongoDB | Stores users, documents, chat history, evaluation logs, benchmark questions, and benchmark results |
| Mongoose | Schema and model layer for MongoDB |
| Multer | Receives uploaded document files in memory |
| Cloudinary | Stores original uploaded document files as raw assets |
| pdf-parse, mammoth, pptx2json, xlsx | Extract text from uploaded document buffers |
| LangChain JS | Provides `RecursiveCharacterTextSplitter` for chunking extracted text |
| Jina Embeddings | Converts document chunks and user questions into vectors |
| Pinecone | Stores vectors and performs semantic similarity search |
| Groq SDK | Generates final answers, query rewrites, and grounding/evaluation responses |
| JWT | Protects user-specific APIs |
| Zod | Validates request bodies, params, and query strings |
| Swagger | Serves API documentation through `/api-docs` |

## Architecture Diagram

```text
USER
 ↓
REACT FRONTEND
 ↓
EXPRESS BACKEND
 ├── App Layer
 │    ├── src/server.ts → dotenv + MongoDB connection + app.listen
 │    └── src/app.ts → helmet + cors + json parser + routes + error handlers
 │
 ├── Auth Module
 │    ├── /api/auth routes
 │    ├── auth.controller.ts
 │    ├── auth.service.ts
 │    ├── JWT token generation
 │    └── User model → MongoDB
 │
 ├── Document Module
 │    ├── /api/documents routes
 │    ├── document.controller.ts
 │    ├── document.service.ts
 │    ├── Multer upload middleware
 │    ├── Cloudinary raw document storage
 │    ├── Format-specific text extraction
 │    ├── LangChain JS text chunking
 │    ├── Generic heading metadata
 │    ├── Jina Embeddings
 │    ├── Pinecone Vector DB
 │    ├── Reindex / re-embed flow
 │    └── Document model → MongoDB
 │
 ├── Chat Module
 │    ├── /api/chat routes
 │    ├── chat.controller.ts
 │    ├── chat.service.ts
 │    ├── Basic RAG
 │    │    ├── Jina question embedding
 │    │    ├── Pinecone retrieval
 │    │    ├── Groq answer generation
 │    │    └── Groq grounding check
 │    ├── Corrective RAG
 │    │    ├── Groq query rewriting
 │    │    ├── Pinecone semantic retrieval
 │    │    ├── relevance evaluation
 │    │    ├── AI-generated fallback when context is insufficient
 │    │    ├── Groq answer generation
 │    │    └── Groq grounding/self-check
 │    └── ChatHistory model → MongoDB
 │
 ├── Evaluation Module
 │    ├── /api/evaluation routes
 │    ├── evaluation.controller.ts
 │    ├── evaluation.service.ts
 │    └── RagEvaluationLog model → MongoDB
 │
 └── Benchmark Module
      ├── /api/benchmark routes
      ├── benchmark.controller.ts
      ├── benchmark.service.ts
      ├── runs Basic RAG and Corrective RAG for comparison
      ├── Groq answer evaluation
      ├── BenchmarkQuestion model → MongoDB
      └── BenchmarkResult model → MongoDB
```

## Upload Flow

```text
UPLOAD FLOW

User
 → React Frontend
 → Express Backend
 → Auth Middleware
 → Document Route: POST /api/documents/upload
 → Multer Memory Upload
 → Document Text Extraction
 → Cloudinary Raw Document Storage
 → MongoDB Document Metadata
 → LangChain RecursiveCharacterTextSplitter
 → Generic Heading Metadata
 → Jina Embeddings
 → Pinecone Vector Upsert
 → Upload Response
```

Source-level flow:

```text
document.routes.ts
 → uploadMiddleware.single("file")
 → document.controller.uploadDocument
 → document.service.createDocument
 → documentExtraction.extractDocumentText
 → cloudinary.service.uploadDocumentToCloudinary
 → StudyDocument.create
 → rag.service.indexDocumentForRag
 → textSplitter.splitTextIntoChunks
 → vector.service.upsertDocumentChunks
 → embedding.service.generateEmbeddings
 → Pinecone upsert
```

## Chatbot Flow

```text
CHAT FLOW

User Question
 → React Frontend
 → Express Backend
 → Auth Middleware
 → Chat Route: POST /api/chat/ask
 → chat.service.askQuestion
 → Basic RAG or Corrective RAG
 → Jina Question Embedding
 → Pinecone Semantic Search
 → Relevant Chunks
 → Groq Answer Generation
 → Groq Grounding Check
 → MongoDB Chat History
 → MongoDB Evaluation Log
 → Answer + Sources
```

## Basic RAG vs Corrective RAG

| Area | Basic RAG | Corrective RAG |
|---|---|---|
| Entry service | `askQuestionWithRag` | `askQuestionWithCorrectiveRag` |
| Query | Uses the original question | Rewrites the question while preserving intent |
| Retrieval | Pinecone semantic search | Pinecone semantic search, optionally with a second pass |
| Relevance scoring | Treats retrieved chunks as selected context | Evaluates chunks using Pinecone score and lexical relevance signals |
| Fallback | Generates a safe fallback when no chunks exist or grounding fails | Generates a safe fallback when chunks are missing, weak, or grounding fails |
| Answer generation | Groq answer from selected context | Groq answer from top relevant context |
| Grounding | Groq grounding check and strict retry | Groq grounding check and strict retry |
| Logging | Chat history and evaluation log | Chat history and richer corrective evaluation metadata |

## RAG Component Roles

### Chunking

The backend uses LangChain JS `RecursiveCharacterTextSplitter` with overlapping chunks. Chunk metadata includes text length and a generic section value. The section value is only metadata; retrieval remains primarily semantic.

### Generic Heading Metadata

Heading detection does not use document-type-specific keywords. It uses generic format signals such as short line length, uppercase ratio, no ending punctuation, isolated lines, and numbered heading patterns. If no heading is detected confidently, chunks remain `UNKNOWN` or generic `CONTENT`.

### Jina Embeddings

`embedding.service.ts` calls the Jina embeddings API with the configured `JINA_EMBEDDING_MODEL`. It embeds both document chunks during indexing and user questions during retrieval.

### Pinecone Vector DB

`vector.service.ts` stores chunk embeddings in Pinecone with metadata:

- `documentId`
- `userId`
- `subject`
- `title`
- `chunkIndex`
- `section`

### Vietnamese Relevance Tuning

Corrective RAG defaults to `RELEVANCE_THRESHOLD=0.55`, configured in `src/config/rag.config.ts`. A higher threshold improves precision by filtering weaker context, but may reduce recall. Tune `RELEVANCE_THRESHOLD`, `PINECONE_RELEVANCE_THRESHOLD`, and `MIN_RELEVANT_CHUNKS` through environment variables.
- `content`

Retrieval filters by `userId` and optionally by `documentId` or `subject`.

### Groq Answer Generation

`groq.service.ts` uses `groq-sdk` for chat completions. It handles:

- final answer generation
- concise/entity-style answers
- answer compression
- retry logic for rate limits and transient API errors

### Query Rewriting

`queryRewrite.service.ts` rewrites non-entity questions into clearer academic search queries. Entity extraction questions are kept close to the original question.

### Relevance Evaluation

`relevance.service.ts` combines Pinecone similarity score with lightweight lexical signals. Pinecone score is the primary semantic signal.

### Grounding Check

`answerCheck.service.ts` asks Groq to return JSON describing whether the answer is grounded in retrieved context. Low confidence or parse failure results in an ungrounded answer state.

## Persistence Model

```text
MongoDB
 ├── users
 ├── documents
 ├── chat histories
 ├── RAG evaluation logs
 ├── benchmark questions
 └── benchmark results

Cloudinary
 └── raw uploaded PDF files

Pinecone
 └── document chunk vectors + retrieval metadata
```

## Reindex Flow

```text
POST /api/documents/:documentId/reindex
 → Load document from MongoDB
 → Delete old Pinecone vectors for documentId
 → Re-run chunking
 → Re-generate Jina embeddings
 → Re-upsert vectors into Pinecone
 → Return deletedVectorCount, chunksCreated, detectedSections, upsertedVectorCount
```

Reindexing is needed when chunking or metadata logic changes because Pinecone vectors do not update automatically from MongoDB.

## External Services

```text
Express Backend
 ├── MongoDB Atlas / MongoDB instance
 ├── Cloudinary API
 ├── Jina Embeddings API
 ├── Pinecone API
 └── Groq API
```

## Key Source Files

| Area | Files |
|---|---|
| App bootstrap | `src/server.ts`, `src/app.ts` |
| Routes | `src/routes/*.routes.ts` |
| Controllers | `src/controllers/*.controller.ts` |
| Services | `src/services/*.service.ts` |
| Models | `src/models/*.model.ts` |
| Middleware | `src/middlewares/*.middleware.ts` |
| Validation | `src/validations/*.validation.ts` |
| RAG types | `src/types/rag.types.ts` |
| API types | `src/types/api.types.ts` |
| Chunking and intent utilities | `src/utils/textSplitter.ts`, `src/utils/documentSection.ts`, `src/utils/ragIntent.ts`, `src/utils/answerStyle.ts` |
