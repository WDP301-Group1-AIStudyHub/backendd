# Backend Architecture

This document explains the current generalized backend architecture for AI Study Hub.

## High-Level System

```text
User
↓
React Frontend
↓
Express Backend
↓
MongoDB / Cloudinary
↓
PDF Extraction
↓
Chunking
↓
Gemini Embedding
↓
Pinecone Vector DB
↓
Groq Answer Generation
↓
MongoDB Chat History
```

## Backend Responsibilities

- Authenticate users with JWT.
- Validate request payloads with Zod.
- Accept PDF uploads with Multer.
- Store raw files in Cloudinary.
- Extract text from PDFs.
- Chunk extracted text.
- Generate embeddings with Gemini.
- Store and query vectors in Pinecone.
- Run Basic RAG and Corrective RAG.
- Generate grounded answers with Groq.
- Store chat history, benchmarks, and evaluation logs in MongoDB.

## Data Storage Strategy

### MongoDB

MongoDB stores application data:

- users
- document metadata
- extracted text
- chat history
- evaluation logs
- benchmark questions/results

### Cloudinary

Cloudinary stores uploaded PDF files as raw assets. MongoDB stores only the file URL and metadata.

### Pinecone

Pinecone stores vector embeddings for document chunks. Each vector includes metadata:

- `documentId`
- `userId`
- `subject`
- `title`
- `chunkIndex`
- `section`
- `content`

## Generic Chunking and Heading Detection

The backend does not use fixed document-specific heading keyword sets.

Heading detection is based on format signals:

- line is short enough to be a heading
- high uppercase ratio
- no ending punctuation
- isolated line
- followed by content
- generic numbered headings such as `1.`, `1.1`, `Chapter 1`, `Section 2`

Possible section metadata:

- `CONTENT`
- `INSTRUCTIONS`
- `QUESTIONS`
- `SUMMARY`
- `UNKNOWN`

In practice, retrieval does not depend on hard-coded section names. Section metadata is secondary context only.

## RAG Architecture

```text
User Question
↓
Gemini Query Embedding
↓
Pinecone Semantic Search
↓
Relevant Chunks
↓
Groq Answer Generation
↓
Grounding Check
↓
Answer + Sources
```

## Corrective RAG

Corrective RAG improves the basic flow by adding:

- query rewriting
- relevance evaluation
- second-pass retrieval when needed
- fallback to top semantic matches if all chunks are rejected
- answer grounding/self-check
- evaluation logging

The flow remains document-type independent. It relies on semantic similarity, Pinecone scores, relevance score, and user intent.

## Design Decisions

### Why hard-coded heading logic was removed

The application must support general study documents. Fixed heading lists are brittle because real PDFs have inconsistent formatting, languages, and structures.

### Why semantic retrieval is more scalable

Embedding search works across wording variations and document styles. It does not require every document to use the same headings or keywords.

### Why the system supports general documents

AI Study Hub is intended for learning workflows, not one file format or document domain. The backend should work for lecture slides, notes, exams, technical docs, and papers.
