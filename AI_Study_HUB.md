# AI Study Hub

AI Study Hub is a study-document assistant. Users upload course material, the
backend indexes it with embeddings, and chat answers are generated only from
retrieved document context.

## Current AI Architecture

- Extract text from PDF, DOCX, PPTX, XLSX, TXT, and Markdown files.
- Split documents with heading/outline-aware chunking.
- Embed chunks with Jina and store vectors in Pinecone.
- Answer questions with one DR-RAG pipeline.
- Use Groq for query rewrite, answer generation, grounding checks, and answer
  evaluation.
- Store chat history, sources, and DR-RAG evaluation metrics in MongoDB.

## DR-RAG Goals

- Improve recall for multi-hop questions by combining the question with
  retrieved static chunks and running a second dynamic retrieval stage.
- Reduce redundant context through CFS-style heuristic selection.
- Keep answers grounded in uploaded documents.
- Return safe fallback responses when retrieval or grounding is insufficient.
- Benchmark the production DR-RAG pipeline with correctness, faithfulness,
  relevance, completeness, and overall score.
