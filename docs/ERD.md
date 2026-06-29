# AI Study Hub ERD

```dbml
Table User {
  _id ObjectId [pk]
  fullName varchar
  email varchar [unique]
  password varchar
  role varchar
  createdAt datetime
  updatedAt datetime
}

Table Subject {
  _id ObjectId [pk]
  ownerId ObjectId [ref: > User._id]
  name varchar
  code varchar
  description varchar
  color varchar
  semester varchar
  createdAt datetime
  updatedAt datetime
}

Table Document {
  _id ObjectId [pk]
  ownerId ObjectId [ref: > User._id]
  subjectId ObjectId [ref: > Subject._id]
  title varchar
  description varchar
  visibility varchar
  status varchar
  currentVersionId ObjectId [ref: > DocumentVersion._id]
  totalVersions int
  totalChunks int
  chunkingStrategy varchar
  detectedSections varchar[]
  documentOutline json
  chapterCount int
  partCount int
  sectionCount int
  lastIndexedAt datetime
  fileUrl varchar
  filePublicId varchar
  fileName varchar
  extractedText text
  createdAt datetime
  updatedAt datetime
}

Table DocumentVersion {
  _id ObjectId [pk]
  documentId ObjectId [ref: > Document._id]
  versionNumber int
  uploadMode varchar
  fileUrl varchar
  fileName varchar
  extractedText text
  extractionStatus varchar
  processingStatus varchar
  totalChunks int
  chunkingStrategy varchar
  detectedSections varchar[]
  documentOutline json
  indexedAt datetime
  isActive boolean
  uploadedBy ObjectId [ref: > User._id]
  createdAt datetime
  updatedAt datetime

  indexes {
    (documentId, versionNumber) [unique]
  }
}

Table ChatThread {
  _id ObjectId [pk]
  ownerId ObjectId [ref: > User._id]
  title varchar
  status varchar
  lastMessageAt datetime
  messageCount int
  scope varchar
  subjectId ObjectId [ref: > Subject._id]
  documentId ObjectId [ref: > Document._id]
  documentIds ObjectId[]
  mode varchar [note: "enum: dr-rag; default: dr-rag"]
  createdAt datetime
  updatedAt datetime
}

Table ChatHistory {
  _id ObjectId [pk]
  userId ObjectId [ref: > User._id]
  threadId ObjectId [ref: > ChatThread._id]
  question varchar
  originalQuestion varchar
  rewrittenQuery varchar
  answer text
  sources json
  documentId ObjectId [ref: > Document._id]
  documentIds ObjectId[]
  subjectId ObjectId [ref: > Subject._id]
  scope varchar
  mode varchar [note: "enum: dr-rag; default: dr-rag"]
  evaluation json [note: "DR-RAG evaluation snapshot"]
  createdAt datetime
  updatedAt datetime
}

Table RagEvaluationLog {
  _id ObjectId [pk]
  userId ObjectId [ref: > User._id]
  question varchar
  rewrittenQuery varchar
  retrievalMode varchar [note: "enum: dr-rag"]
  retrievedChunksCount int
  relevantChunksCount int
  averageRelevanceScore float
  isGrounded boolean
  confidenceScore float
  responseTimeMs int
  stageOneChunksCount int
  stageTwoChunksCount int
  selectedStaticChunksCount int
  selectedDynamicChunksCount int
  dynamicRetrievalAttempted boolean
  selectionStrategy varchar [note: "cfs-heuristic"]
  retrievalQueries varchar[]
  relevanceThreshold float
  fallbackGenerated boolean
  fallbackReason varchar
  detectedIntent varchar
  retrievedSections varchar[]
  createdAt datetime
}

Table BenchmarkQuestion {
  _id ObjectId [pk]
  question varchar
  expectedAnswer varchar
  subject varchar
  documentId ObjectId [ref: > Document._id]
  difficulty varchar
  createdBy ObjectId [ref: > User._id]
  createdAt datetime
  updatedAt datetime
}

Table BenchmarkResult {
  _id ObjectId [pk]
  benchmarkQuestionId ObjectId [ref: > BenchmarkQuestion._id]
  question varchar
  expectedAnswer varchar
  answer text
  evaluation json [note: "answerCorrectness, faithfulness, relevance, completeness, overallScore, explanation"]
  createdBy ObjectId [ref: > User._id]
  createdAt datetime
}
```

## Notes

- Chunks and embeddings are stored in Pinecone, not MongoDB.
- Chat and evaluation records keep `mode = dr-rag` as read-only audit metadata.
- Benchmark results now evaluate the single production DR-RAG pipeline.
