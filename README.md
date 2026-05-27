# AI Study Hub Backend

AI Study Hub Backend is an Express + TypeScript API for uploading study PDFs and asking AI questions about uploaded documents.

The backend implements a generalized RAG pipeline for study materials such as:

- lecture slides
- notes
- exam documents
- technical documents
- research papers
- general PDFs

It does not rely on document-type-specific retrieval rules or fixed heading keyword lists.

## Core Architecture

```text
React Frontend
↓
Express Backend
↓
MongoDB / Cloudinary
↓
PDF Text Extraction
↓
Chunking + Generic Heading Detection
↓
Gemini Embedding
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
- Cloudinary for storing uploaded PDF files.
- Multer for file upload handling.
- pdf-parse for extracting PDF text.
- Gemini Embedding for text/query vectors.
- Pinecone for semantic vector search.
- Groq for answer generation.
- JWT for authentication.
- Zod for request validation.
- Swagger for API documentation.

## Generic Heading Detection

The chunking pipeline avoids hard-coded document assumptions. Instead of fixed heading keyword sets, heading detection uses format signals:

- short line length
- uppercase ratio
- no ending punctuation
- isolated line detection
- followed by content
- generic numbered heading patterns such as `1.`, `1.1`, `Chapter 1`, `Section 2`

If a heading cannot be detected confidently, the section metadata falls back to `UNKNOWN` or `CONTENT`.

## Main APIs

```text
POST /api/auth/register
POST /api/auth/login

POST /api/documents/upload
GET  /api/documents
POST /api/documents/:documentId/reindex

POST /api/chat/ask
GET  /api/chat/history

GET  /api/evaluation/logs
GET  /api/evaluation/summary
```

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
