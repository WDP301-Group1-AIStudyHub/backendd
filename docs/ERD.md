# ERD

```dbml
Project ai_study_hub {
  database_type: "MongoDB"
}

Table User {
  _id ObjectId [pk]
  fullName varchar [not null]
  email varchar [not null, unique]
  password varchar [not null]
  avatar varchar
  role varchar [note: "enum: user, admin; default: user"]
  createdAt datetime
  updatedAt datetime
}

Table Subject {
  _id ObjectId [pk]
  ownerId ObjectId [not null, ref: > User._id]
  name varchar [not null]
  description varchar
  color varchar
  code varchar [note: "Optional legacy/API compatibility field"]
  createdAt datetime
  updatedAt datetime

  indexes {
    ownerId
    (ownerId, name) [unique]
    (ownerId, code) [unique, note: "Partial unique index when code is a non-empty string"]
  }
}

Table Document {
  _id ObjectId [pk]
  ownerId ObjectId [not null, ref: > User._id]
  subjectId ObjectId [not null, ref: > Subject._id]
  title varchar [not null]
  description varchar
  visibility varchar [not null, note: "enum: PUBLIC, PRIVATE; default: PRIVATE"]
  status varchar [not null, note: "enum: ACTIVE, ARCHIVED, DELETED; default: ACTIVE"]
  totalViews int [not null, note: "default: 0"]
  totalDownloads int [not null, note: "default: 0"]
  currentVersionId ObjectId
  totalVersions int [not null, note: "default: 0"]
  totalChunks int [not null, note: "default: 0"]
  lastIndexedAt datetime
  deletedAt datetime
  fileUrl varchar [note: "Optional upload/RAG compatibility field"]
  filePublicId varchar [note: "Optional upload/RAG compatibility field"]
  fileName varchar [note: "Optional upload/RAG compatibility field"]
  fileType varchar [note: "Optional upload/RAG compatibility field"]
  originalFileName varchar [note: "Optional upload/RAG compatibility field"]
  storedFileName varchar [note: "Optional upload/RAG compatibility field"]
  fileExtension varchar
  mimeType varchar
  fileSize int
  extractedText text [note: "Not used by document metadata search"]
  extractionStatus varchar [note: "enum: COMPLETED, FAILED; default: COMPLETED"]
  extractionError varchar
  createdAt datetime
  updatedAt datetime

  indexes {
    ownerId
    subjectId
    visibility
    status
    createdAt
    (ownerId, subjectId)
    (ownerId, status, createdAt)
    (visibility, status, createdAt)
    (title, description) [type: fulltext]
  }
}

Table DocumentVersion {
  _id ObjectId [pk]
  documentId ObjectId [not null, ref: > Document._id]
  versionNumber int [not null]
  uploadMode varchar [not null, note: "enum: OVERRIDE, APPEND"]
  fileUrl varchar [not null]
  filePublicId varchar [not null]
  fileName varchar [not null]
  originalFileName varchar [not null]
  storedFileName varchar [not null]
  fileType varchar [not null]
  mimeType varchar [not null]
  fileSize int [not null]
  fileExtension varchar [not null]
  extractedText text
  extractionStatus varchar [not null, note: "enum: PENDING, EXTRACTING, COMPLETED, FAILED"]
  extractionError varchar
  totalChunks int [not null, note: "default: 0"]
  indexedAt datetime
  uploadedBy ObjectId [not null, ref: > User._id]
  uploadReason varchar
  isActive boolean [not null]
  deletedAt datetime
  createdAt datetime
  updatedAt datetime

  indexes {
    documentId
    uploadedBy
    isActive
    versionNumber
    createdAt
    (documentId, versionNumber) [unique]
  }
}

Table ChatHistory {
  _id ObjectId [pk]
  userId ObjectId [not null, ref: > User._id]
  question varchar [not null]
  originalQuestion varchar
  rewrittenQuery varchar
  answer text [not null]
  sources json [note: "Array of chat source snapshots: documentId, title, chunkIndex, contentPreview, section metadata, relevanceScore"]
  documentId ObjectId [ref: > Document._id]
  subject varchar [note: "Legacy subject string"]
  subjectId ObjectId [ref: > Subject._id]
  mode varchar [note: "enum: basic, corrective; default: basic"]
  evaluation json [note: "Nested RAG evaluation metrics"]
  createdAt datetime
  updatedAt datetime

  indexes {
    userId
  }
}

Table RagEvaluationLog {
  _id ObjectId [pk]
  userId ObjectId [not null, ref: > User._id]
  question varchar [not null]
  rewrittenQuery varchar
  retrievalMode varchar [not null, note: "enum: basic, corrective"]
  retrievedChunksCount int [not null]
  relevantChunksCount int [not null]
  averageRelevanceScore float [not null]
  correctiveAttempted boolean [not null]
  isGrounded boolean [not null]
  confidenceScore float [not null]
  responseTimeMs int [not null]
  usedFallbackChunks boolean
  relevanceThreshold float
  warning varchar
  fallbackGenerated boolean
  fallbackReason varchar
  detectedIntent varchar
  retrievedSections varchar[]
  createdAt datetime

  indexes {
    userId
    retrievalMode
  }
}

Table BenchmarkQuestion {
  _id ObjectId [pk]
  question varchar [not null]
  expectedAnswer varchar [not null]
  subject varchar
  documentId ObjectId [ref: > Document._id]
  difficulty varchar [not null, note: "enum: easy, medium, hard; default: medium"]
  createdBy ObjectId [not null, ref: > User._id]
  createdAt datetime
  updatedAt datetime

  indexes {
    createdBy
  }
}

Table BenchmarkResult {
  _id ObjectId [pk]
  benchmarkQuestionId ObjectId [not null, ref: > BenchmarkQuestion._id]
  question varchar [not null]
  expectedAnswer varchar [not null]
  basicAnswer text [not null]
  correctiveAnswer text [not null]
  basicEvaluation json [not null, note: "answerCorrectness, faithfulness, relevance, completeness, overallScore, explanation"]
  correctiveEvaluation json [not null, note: "answerCorrectness, faithfulness, relevance, completeness, overallScore, explanation"]
  winner varchar [not null, note: "enum: basic, corrective, tie"]
  createdBy ObjectId [not null, ref: > User._id]
  createdAt datetime

  indexes {
    benchmarkQuestionId
    winner
    createdBy
  }
}
```

## Notes

- Subject thuộc về User qua `Subject.ownerId`.
- Document là root content entity, thuộc về User qua `Document.ownerId` và thuộc về Subject qua `Document.subjectId`.
- Document có nhiều DocumentVersion; `Document.currentVersionId` trỏ tới active version hiện tại.
- ERD quan hệ chính: `User -> Subject -> Document -> DocumentVersion`.
- Document visibility: `PRIVATE` chỉ owner xem được; `PUBLIC` user đã đăng nhập nào cũng xem được.
- Document status: `ACTIVE`, `ARCHIVED`, `DELETED`; delete là soft delete bằng `status = DELETED` và `deletedAt`.
- Không có MongoDB model `DocumentChunk` trong code hiện tại. Chunks/embeddings được lưu ở Pinecone với metadata như `documentId`, `userId`, `subject`, `subjectId`, `title`, `chunkIndex`, section metadata và `content`.
- ChatHistory thuộc về User, có thể liên quan Document và Subject qua `documentId` / `subjectId`; `sources` và `evaluation` là nested JSON snapshots.
- RagEvaluationLog lưu metric RAG cho từng câu hỏi, gồm basic/corrective mode và các chỉ số grounding/relevance/fallback.
- BenchmarkQuestion thuộc về User và có thể gắn Document; BenchmarkResult thuộc về BenchmarkQuestion và User để so sánh basic RAG với corrective RAG.
