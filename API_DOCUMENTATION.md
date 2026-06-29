# AI Study Hub API Documentation

Base URL: `http://localhost:5000/api`

Most routes require `Authorization: Bearer <accessToken>`.

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `PUT /auth/profile`
- `POST /auth/forgot-password`

## Documents

- `POST /documents/upload`: upload and index a document.
- `GET /documents`: list readable documents.
- `GET /documents/:id`: get one document.
- `PUT /documents/:id`: update document metadata.
- `DELETE /documents/:id`: soft delete a document.
- `POST /documents/:documentId/reindex`: re-chunk, re-embed, and re-upsert vectors.
- `GET /debug/documents/:documentId/chunks`: preview chunking output.

Supported RAG file types include PDF, DOCX, PPTX, XLSX, TXT, and MD.

## DR-RAG Configuration

```env
JINA_API_KEY=your-jina-api-key
JINA_EMBEDDING_MODEL=jina-embeddings-v3
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX_NAME=ai-study-hub-jina-1024
PINECONE_NAMESPACE=ai-study-hub
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.1-8b-instant
RELEVANCE_THRESHOLD=0.55
PINECONE_RELEVANCE_THRESHOLD=0.3
MIN_RELEVANT_CHUNKS=3
```

For `jina-embeddings-v3`, create a Pinecone dense index with dimension `1024`
and cosine metric.

## Chat DR-RAG

### `POST /chat/ask`

Ask a question against uploaded document chunks. The request no longer accepts
a RAG `mode`; every chat request uses DR-RAG.

Request:

```json
{
  "question": "Tai lieu noi gi ve phuong trinh bac hai?",
  "documentId": "665f2a..."
}
```

Optional scope fields:

- `documentId` for one document.
- `documentIds` with `scope: "document_set"` for a selected set.
- `subjectId` with `scope: "subject_all"` for a subject.
- no document or subject field to search the user's library.

Response:

```json
{
  "success": true,
  "message": "Question answered successfully",
  "data": {
    "answer": "Answer grounded in uploaded documents.",
    "mode": "dr-rag",
    "originalQuestion": "Tai lieu noi gi ve phuong trinh bac hai?",
    "rewrittenQuery": "Tai lieu noi gi ve phuong trinh bac hai?",
    "sources": [
      {
        "documentId": "665f2a...",
        "title": "Lesson 1",
        "chunkIndex": 0,
        "sectionTitle": "Chapter 2",
        "contentPreview": "Relevant content preview...",
        "relevanceScore": 0.82
      }
    ],
    "evaluation": {
      "retrievedChunksCount": 12,
      "relevantChunksCount": 8,
      "averageRelevanceScore": 0.74,
      "stageOneChunksCount": 4,
      "stageTwoChunksCount": 8,
      "selectedStaticChunksCount": 4,
      "selectedDynamicChunksCount": 2,
      "dynamicRetrievalAttempted": true,
      "selectionStrategy": "cfs-heuristic",
      "retrievalQueries": ["question", "question + static chunk"],
      "isGrounded": true,
      "confidenceScore": 0.88,
      "responseTimeMs": 2450,
      "fallbackGenerated": false
    }
  }
}
```

If retrieved context is insufficient or the answer fails grounding, the backend
returns a safe fallback answer and sets `evaluation.fallbackGenerated = true`.

### Chat History

- `GET /chat/threads`
- `GET /chat/threads/:threadId`
- `PATCH /chat/threads/:threadId`
- `DELETE /chat/threads/:threadId`
- `GET /chat/history`
- `GET /chat/history/:id`
- `DELETE /chat/history/:id`

## Evaluation Logs

- `GET /evaluation/logs`: returns DR-RAG evaluation logs.
- `GET /evaluation/summary`: returns aggregate metrics.

Summary response:

```json
{
  "success": true,
  "message": "Evaluation summary fetched successfully",
  "data": {
    "totalQuestions": 10,
    "averageRelevanceScore": 0.71,
    "averageConfidenceScore": 0.84,
    "averageResponseTime": 2200,
    "drRagModeCount": 10
  }
}
```

## Benchmark

Benchmark APIs evaluate the single production DR-RAG pipeline against an
expected answer.

- `POST /benchmark/questions`
- `GET /benchmark/questions`
- `GET /benchmark/questions/:id`
- `PUT /benchmark/questions/:id`
- `DELETE /benchmark/questions/:id`
- `POST /benchmark/run/:questionId`
- `GET /benchmark/summary`

Benchmark result response:

```json
{
  "success": true,
  "message": "Benchmark run completed successfully",
  "data": {
    "id": "666...",
    "benchmarkQuestionId": "665...",
    "question": "What is supervised learning used for?",
    "expectedAnswer": "Supervised learning uses labeled examples...",
    "answer": "DR-RAG answer...",
    "evaluation": {
      "answerCorrectness": 0.9,
      "faithfulness": 0.92,
      "relevance": 0.9,
      "completeness": 0.85,
      "overallScore": 0.89,
      "explanation": "The answer is accurate and grounded."
    }
  }
}
```

Benchmark summary response:

```json
{
  "success": true,
  "message": "Benchmark summary fetched successfully",
  "data": {
    "totalRuns": 10,
    "averageScore": 0.84,
    "averageAnswerCorrectness": 0.82,
    "averageFaithfulness": 0.9,
    "averageRelevance": 0.86,
    "averageCompleteness": 0.78
  }
}
```
