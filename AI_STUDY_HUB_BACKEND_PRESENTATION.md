# AI Study Hub Backend Presentation

## 1. Backend Purpose

AI Study Hub lets students upload study documents and ask grounded questions
over their own materials.

## 2. Core Stack

| Layer | Technology |
|---|---|
| API | Express, TypeScript |
| Database | MongoDB, Mongoose |
| File storage | Cloudinary |
| Extraction | pdf-parse, mammoth, pptx2json, xlsx |
| Embeddings | Jina embeddings |
| Vector DB | Pinecone |
| LLM | Groq |

## 3. Upload Pipeline

```text
Upload
-> text extraction
-> heading/outline chunking
-> Jina embeddings
-> Pinecone upsert
-> MongoDB document/version metadata
```

## 4. Chat Pipeline

```text
Question
-> scope resolution
-> intent/profile detection
-> DR-RAG stage 1 static retrieval
-> expanded query generation
-> DR-RAG stage 2 dynamic retrieval
-> CFS heuristic selection
-> answer generation
-> grounding check
-> chat/evaluation persistence
```

## 5. Why DR-RAG

Single-query retrieval can miss important second-hop context. DR-RAG first
retrieves directly relevant chunks, then uses each chunk with the question to
find dynamic-relevant chunks that are hard to retrieve from the question alone.

## 6. Evaluation

The backend records:

- retrieved and relevant chunk counts
- stage 1 and stage 2 retrieval counts
- selected static and dynamic chunk counts
- selection strategy
- grounding confidence
- fallback reason
- response time

## 7. Benchmark

Benchmark runs evaluate the single production DR-RAG answer against an expected
answer using correctness, faithfulness, relevance, completeness, and overall
score.
