# Generalized RAG Flow

This document describes the current RAG pipeline in AI Study Hub.

## Upload and Indexing Flow

```text
Document Upload (PDF, DOCX, PPTX, XLSX, TXT, MD)
↓
Multer receives file
↓
Cloudinary stores raw document
↓
Format-specific parser extracts plain text
↓
Generic chunking
↓
Format-based heading detection
↓
Jina embeddings
↓
Pinecone upsert
```

## Heading Detection

The backend no longer uses hard-coded heading keyword sets.

Instead, the chunking pipeline detects likely headings by format:

- short line length
- uppercase ratio
- line has no ending punctuation
- line appears isolated
- line is followed by content
- numbered heading patterns are allowed as generic structure markers

Examples of generic numbered headings:

```text
1. Overview
1.1 REST API
Chapter 2
Section 3
```

If the system is not confident that a line is a heading, it does not force a section. The chunk remains `UNKNOWN` or general `CONTENT`.

## Question Answering Flow

```text
User Question
↓
Detect query intent and answer style
↓
Generate query embedding
↓
Pinecone semantic search
↓
Evaluate chunk relevance
↓
Select top relevant chunks
↓
Groq answer generation
↓
Grounding check
↓
Save chat history and evaluation log
```

## Basic RAG

Basic RAG:

1. Uses the original question.
2. Searches Pinecone.
3. Selects top chunks.
4. Generates answer.
5. Runs grounding check.

## Corrective RAG

Corrective RAG:

1. Rewrites the query while preserving intent.
2. Searches Pinecone.
3. Evaluates chunk relevance.
4. Runs second-pass retrieval if relevant chunks are insufficient.
5. Deduplicates chunks.
6. Falls back to top semantic matches if needed.
7. Generates answer with Groq.
8. Checks grounding.
9. Regenerates once with stricter grounding if needed.
10. Logs evaluation metadata.

## Retrieval Signals

The backend relies mainly on:

- Jina embeddings
- Pinecone vector similarity
- Pinecone score
- relevance score
- user query intent

It does not rely on document-type-specific retrieval heuristics.

## Reindexing

When chunking or metadata changes, old vectors in Pinecone may contain stale metadata. Reindex with:

```http
POST /api/documents/:documentId/reindex
```

The reindex flow:

```text
MongoDB document
↓
Delete old Pinecone vectors
↓
Re-run chunking
↓
Re-generate embeddings
↓
Upsert new vectors
```

## Design Decisions

### No document-type-specific assumptions

The RAG system must work for lecture slides, notes, exams, technical documents, and research papers.

### Semantic retrieval first

Embedding search is more scalable than keyword or section matching because it compares meaning.

### Heading detection as metadata only

Heading detection helps organize chunks, but it is not the main retrieval mechanism.
