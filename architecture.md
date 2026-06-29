# Backend Architecture

AI Study Hub is an Express + TypeScript backend for Vietnamese educational
document question answering. Chat uses one production RAG pipeline: DR-RAG.

## High-Level System

```text
User
-> React/Mobile clients
-> Express backend
-> MongoDB / Cloudinary
-> Text extraction and chunking
-> Jina embeddings
-> Pinecone vector DB
-> DR-RAG retrieval and selection
-> Groq answer generation and grounding
-> MongoDB chat/evaluation storage
```

## Backend Responsibilities

- Authenticate users with JWT.
- Validate request payloads with Zod.
- Accept PDF, DOCX, PPTX, XLSX, TXT, and MD uploads.
- Store raw files in Cloudinary.
- Extract plain text from uploaded documents.
- Chunk extracted text with heading/outline metadata.
- Generate embeddings with Jina.
- Store and query vectors in Pinecone.
- Run DR-RAG stage 1 retrieval, stage 2 dynamic retrieval, and CFS heuristic selection.
- Generate grounded answers with Groq.
- Store chat history, benchmark results, and evaluation logs in MongoDB.

## Data Storage

- MongoDB stores users, subjects, documents, versions, chat history, evaluation logs, and benchmark records.
- Cloudinary stores uploaded raw document files.
- Pinecone stores document chunk vectors plus metadata such as `documentId`, `userId`, `subjectId`, `title`, `chunkIndex`, section metadata, outline metadata, and `content`.

## Chunking

The backend uses generic heading/outline signals instead of document-specific
keyword lists. Section metadata is helpful for context display and selection,
but semantic retrieval remains the primary retrieval signal.

## DR-RAG Architecture

```text
User question
-> intent/profile detection
-> Stage 1 Pinecone retrieval for static-relevant chunks
-> expanded queries from question + static chunks
-> Stage 2 Pinecone retrieval for dynamic-relevant chunks
-> CFS-style heuristic selection
-> final context
-> Groq answer
-> grounding check
-> answer or safe fallback
```

The backend does not expose multiple RAG modes. Requests containing legacy
`mode` fields are rejected by validation.
