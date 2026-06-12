# AI Study Hub Backend

AI Study Hub Backend is an Express + TypeScript API for uploading study documents and asking AI questions about uploaded documents.

The backend focuses on Vietnamese educational document Q&A while keeping the RAG pipeline generic enough for study materials such as:

- lecture slides
- notes
- exam documents
- technical documents
- research papers
- general PDFs, DOCX, PPTX, XLSX, TXT, and MD files

It does not rely on document-type-specific retrieval rules or fixed heading keyword lists.

## Core Architecture

```text
React Frontend
↓
Express Backend
↓
MongoDB / Cloudinary
↓
Document Text Extraction
↓
Chunking + Generic Heading Detection
↓
Jina Embeddings
↓
Pinecone Semantic Search
↓
Groq Answer Generation
↓
Chat History / Evaluation Logs
```

## RAG Flow

```text
User Question
↓
Embedding
↓
Pinecone Semantic Search
↓
Relevant Chunks
↓
Groq Answer Generation
↓
Grounding Check
```

## Tech Stack

- Node.js + Express for REST APIs.
- TypeScript for type-safe backend code.
- MongoDB + Mongoose for users, documents, chat history, benchmarks, and logs.
- Cloudinary for storing uploaded document files.
- Multer for file upload handling.
- pdf-parse, mammoth, pptx2json, and xlsx for extracting document text.
- Jina Embeddings for text/query vectors.
- Pinecone for semantic vector search.
- Groq for answer generation.
- JWT for authentication.
- Zod for request validation.
- Swagger for API documentation.

## Heading-Based Chunking

The chunking pipeline splits documents by headings and sections before using fixed-size splitting. It avoids hard-coded document assumptions and detects headings with generic format signals:

- short line length
- uppercase ratio
- no ending punctuation
- isolated line detection
- followed by content
- generic numbered heading patterns such as `1.`, `1.1`, `Chapter 1`, `Section 2`

Each chunk keeps the section heading at the top of its content, which helps the LLM retain chapter or lesson context during retrieval and answer generation. This reduces broken meaning across chunk boundaries, improves retrieval quality, and works better for study materials with chapters, slides, and titled sections.

If no headings are detected, the pipeline falls back to fixed-size chunks and marks the section as `General Content`.

## Vietnamese RAG Tuning

Prompts prioritize Vietnamese study documents: Vietnamese questions are answered in Vietnamese, accents and subject terms are preserved, and answers use only retrieved context from uploaded files. If the context is insufficient, the API generates a short fallback answer with Groq instead of answering from outside knowledge.

The fallback explains why the system cannot answer, such as no relevant chunks found, retrieved chunks not being relevant enough, grounding failure, the file needing re-indexing, or text extraction quality. It does not answer the actual question and is capped to a short response so users know what to try next.

Corrective RAG uses `RELEVANCE_THRESHOLD=0.55` by default. This higher threshold improves precision by filtering weaker chunks, but it can reduce recall. Tune `RELEVANCE_THRESHOLD`, `PINECONE_RELEVANCE_THRESHOLD`, and `MIN_RELEVANT_CHUNKS` through environment variables.

## Main APIs

```text
POST /api/auth/register
POST /api/auth/login

POST /api/subjects
GET  /api/subjects
PUT  /api/subjects/:id
DELETE /api/subjects/:id

POST /api/documents
POST /api/documents/upload
GET  /api/documents
GET  /api/documents/:id
PUT  /api/documents/:id
DELETE /api/documents/:id
POST /api/documents/:documentId/versions
GET  /api/documents/:documentId/versions
GET  /api/documents/:documentId/versions/:versionId
PATCH /api/documents/:documentId/versions/:versionId/activate
POST /api/documents/:documentId/versions/:versionId/reindex
DELETE /api/documents/:documentId/versions/:versionId
POST /api/documents/:documentId/reindex
GET  /api/upload-sessions/:uploadSessionId

POST /api/chat/ask
GET  /api/chat/history

GET  /api/evaluation/logs
GET  /api/evaluation/summary
```

## Core Document Domain

Phase 4 makes Document the root content entity. File upload and RAG still exist, but document metadata now lives independently so later phases can add versioning, background processing, progress tracking, analytics, and sharing without redesigning the core model.

```text
User
└── Subject
    └── Document
        └── DocumentVersion
```

Subject stores the user's study domain such as `PRM392`, `SWD392`, `DBI202`, `AI Research`, or `Japanese N4`.

Document stores ownership and lifecycle metadata:

- `ownerId`
- `subjectId`
- `title`
- `description`
- `visibility`: `PUBLIC` or `PRIVATE`
- `status`: `ACTIVE`, `ARCHIVED`, or `DELETED`
- `totalViews`
- `totalDownloads`
- `currentVersionId`
- `totalVersions`
- `totalChunks`
- `lastIndexedAt`
- `deletedAt`

`DELETE /api/documents/:id` is a soft delete. It sets `status = DELETED` and `deletedAt = new Date()` instead of removing the MongoDB document.

`GET /api/documents` supports pagination and filters:

```http
GET /api/documents?page=1&limit=10&subjectId=...&keyword=react&visibility=PUBLIC
```

Search only matches `title` and `description`; extracted text remains reserved for RAG indexing.

## Document Versioning

Document is the logical study document. DocumentVersion is a concrete uploaded file for that document.

Example:

```text
Document: Lecture 3 - React Hooks
├── v1: original file
├── v2: corrected file
└── v3: updated file with examples

Active version: v3
```

Version upload uses:

```http
POST /api/documents/:documentId/versions
Content-Type: multipart/form-data
```

Fields:

- `file`: PDF, DOCX, PPTX, XLSX, TXT, or MD.
- `uploadMode`: `OVERRIDE` or `APPEND`.
- `uploadReason`: optional note, max 500 characters.
- `makeActive`: optional boolean for `APPEND`, default `true`.

Rules:

- Owner can upload, activate, and delete non-active versions.
- Archived documents can be viewed but cannot receive new uploads.
- Deleted documents reject version operations.
- Public viewers can view active version metadata only.
- Private documents are visible only to the owner.
- Active version text is synchronized to the Document legacy fields so existing chat/RAG flows continue to use the current active version.

## Socket.IO Upload Progress

Document upload still uses the normal HTTP API. Socket.IO is used only to notify the frontend about upload/indexing progress while the HTTP request is processing.

```text
Upload file
↓
Cloudinary
↓
Create DocumentVersion
↓
Create UploadSession
↓
Emit upload:started
↓
Extract text
↓
Emit upload:extracting_text
↓
Chunk document
↓
Emit upload:chunking
↓
Generate embeddings
↓
Emit upload:embedding
↓
Upsert Pinecone vectors
↓
Emit upload:completed or upload:failed
```

The frontend should connect to Socket.IO before starting upload, then join a room by document id or upload session id:

```text
join:document
join:upload-session
```

Progress events:

```text
upload:started
upload:processing
upload:extracting_text
upload:chunking
upload:embedding
upload:indexing
upload:completed
upload:failed
```

Event payload:

```json
{
  "documentId": "...",
  "uploadSessionId": "...",
  "versionId": "...",
  "status": "processing",
  "step": "EMBEDDING",
  "progress": 60,
  "message": "Generating embeddings"
}
```

Version upload processes synchronously and returns the final version status:

```http
POST /api/documents/:documentId/versions
```

The response includes `uploadSessionId`, `processingStatus`, `processingStage`, and `processingProgress`. Poll upload status as a fallback with:

```http
GET /api/upload-sessions/:uploadSessionId
```

Local setup:

```bash
npm run dev
```

Chat safety: if a document's active version is still processing, chat returns `Tài liệu đang được xử lý, vui lòng thử lại sau.` and does not query Pinecone.

## Reindexing

If chunking or metadata logic changes, existing Pinecone vectors must be rebuilt:

```http
POST /api/documents/:documentId/reindex
```

This flow deletes old vectors, chunks the document again, regenerates embeddings, and upserts fresh vectors into Pinecone.

## Design Decisions

### Why remove hard-coded document logic?

AI Study Hub is a general study assistant. Hard-coded rules for one document type do not scale to slides, exams, notes, papers, or technical PDFs.

### Why semantic retrieval?

Semantic retrieval uses embeddings and Pinecone similarity scores, so it can find relevant chunks even when the user's wording differs from the source document.

### Why keep heading detection generic?

Heading metadata can help organize chunks, but retrieval should remain driven by semantic similarity rather than fixed document-type assumptions.
