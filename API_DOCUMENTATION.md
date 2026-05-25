# AI Study Hub Phase 1 API

Base URL: `https://backendd-vn1j.onrender.com//api`

All protected routes require:

```http
Authorization: Bearer <accessToken>
```

Standard response:

```json
{
  "success": true,
  "message": "Message",
  "data": {}
}
```

Error response:

```json
{
  "success": false,
  "message": "Validation or server error",
  "error": "Details in development"
}
```

## Setup

```bash
npm install
npm run dev
```

Required environment variables are listed in `.env.example`.

## Auth

### POST `/auth/register`

Request:

```json
{
  "fullName": "Nguyen Gia Huy",
  "email": "huy@example.com",
  "password": "password123",
  "avatar": "https://example.com/avatar.png"
}
```

Response:

```json
{
  "success": true,
  "message": "Registered successfully",
  "data": {
    "user": {
      "id": "665f1c...",
      "fullName": "Nguyen Gia Huy",
      "email": "huy@example.com",
      "avatar": "https://example.com/avatar.png",
      "role": "user",
      "createdAt": "2026-05-23T00:00:00.000Z",
      "updatedAt": "2026-05-23T00:00:00.000Z"
    },
    "accessToken": "jwt-token"
  }
}
```

### POST `/auth/login`

Request:

```json
{
  "email": "huy@example.com",
  "password": "password123"
}
```

Response data shape is the same as register.

### POST `/auth/logout`

Protected. The backend is stateless, so the frontend removes the token.

Response:

```json
{
  "success": true,
  "message": "Logged out successfully. Remove the token on the client."
}
```

### GET `/auth/me`

Protected.

Response:

```json
{
  "success": true,
  "message": "Current user fetched successfully",
  "data": {
    "id": "665f1c...",
    "fullName": "Nguyen Gia Huy",
    "email": "huy@example.com",
    "avatar": "",
    "role": "user",
    "createdAt": "2026-05-23T00:00:00.000Z",
    "updatedAt": "2026-05-23T00:00:00.000Z"
  }
}
```

### PUT `/auth/profile`

Protected.

Request:

```json
{
  "fullName": "Huy Nguyen",
  "avatar": "https://example.com/new-avatar.png"
}
```

Response data shape is `UserResponse`.

### POST `/auth/forgot-password`

Request:

```json
{
  "email": "huy@example.com"
}
```

Response:

```json
{
  "success": true,
  "message": "If the email exists, password reset instructions will be sent later.",
  "data": {
    "email": "huy@example.com"
  }
}
```

## Documents

### POST `/documents/upload`

Protected. Send `multipart/form-data`.

Fields:

- `file`: PDF file, max 10MB
- `title`: required string
- `description`: optional string
- `subject`: optional string

Example:

```bash
curl -X POST http://localhost:5000/api/documents/upload \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@lesson.pdf" \
  -F "title=Lesson 1" \
  -F "subject=Math" \
  -F "description=Algebra notes"
```

Response:

```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "data": {
    "id": "665f2a...",
    "title": "Lesson 1",
    "description": "Algebra notes",
    "subject": "Math",
    "fileUrl": "https://res.cloudinary.com/.../lesson.pdf",
    "filePublicId": "ai-study-hub/documents/...",
    "fileName": "lesson.pdf",
    "fileType": "application/pdf",
    "fileSize": 123456,
    "extractedText": "Extracted PDF text...",
    "uploadedBy": "665f1c...",
    "createdAt": "2026-05-23T00:00:00.000Z",
    "updatedAt": "2026-05-23T00:00:00.000Z"
  }
}
```

### GET `/documents`

Protected. Returns the current user's documents.

Response:

```json
{
  "success": true,
  "message": "Documents fetched successfully",
  "data": {
    "documents": [],
    "total": 0
  }
}
```

### GET `/documents/:id`

Protected. Returns one document owned by the current user.

### PUT `/documents/:id`

Protected.

Request:

```json
{
  "title": "Updated Lesson 1",
  "description": "Updated notes",
  "subject": "Physics"
}
```

Response data shape is `DocumentResponse`.

### DELETE `/documents/:id`

Protected. Deletes MongoDB metadata and the Cloudinary raw file.

Response:

```json
{
  "success": true,
  "message": "Document deleted successfully"
}
```

### GET `/documents/search?keyword=&subject=`

Protected. Both query parameters are optional.

Example:

```http
GET /api/documents/search?keyword=algebra&subject=Math
```

Response data shape is `DocumentListResponse`.

## Chat RAG

All chat routes are protected and require a bearer token.

Before testing RAG, create a Pinecone index and configure:

```env
GEMINI_API_KEY=your-gemini-api-key
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_INDEX_NAME=ai-study-hub
PINECONE_NAMESPACE=ai-study-hub
```

The Pinecone index dimension must match the Gemini embedding model output.
For `text-embedding-004`, create a dense index with dimension `768` and cosine metric.

### POST `/chat/ask`

Protected. Ask a question against uploaded document chunks.

Modes:

- `basic`: Phase 2 naive RAG. Uses the original question for retrieval.
- `corrective`: Phase 3 improved RAG. Rewrites the query, scores chunk relevance, retries retrieval if needed, self-checks grounding, and logs evaluation metrics.

Request:

```json
{
  "question": "Tài liệu nói gì về phương trình bậc hai?",
  "documentId": "665f2a...",
  "mode": "corrective"
}
```

You can omit `documentId` and use `subject` instead:

```json
{
  "question": "Tóm tắt nội dung chính của tài liệu môn Math",
  "subject": "Math"
}
```

If neither `documentId` nor `subject` is provided, the backend searches all documents uploaded by the current user.

Response:

```json
{
  "success": true,
  "message": "Question answered successfully",
  "data": {
    "answer": "Câu trả lời dựa trên nội dung tài liệu đã upload.",
    "mode": "corrective",
    "originalQuestion": "Tài liệu nói gì về phương trình bậc hai?",
    "rewrittenQuery": "Explain the concept of quadratic equations in the uploaded study document.",
    "sources": [
      {
        "documentId": "665f2a...",
        "title": "Lesson 1",
        "chunkIndex": 0,
        "contentPreview": "Đoạn nội dung liên quan...",
        "relevanceScore": 0.82
      }
    ],
    "evaluation": {
      "retrievedChunksCount": 8,
      "relevantChunksCount": 4,
      "averageRelevanceScore": 0.72,
      "correctiveAttempted": true,
      "isGrounded": true,
      "confidenceScore": 0.88,
      "responseTimeMs": 2450
    }
  }
}
```

If the retrieved context is insufficient, the answer is:

```text
Tôi không tìm thấy thông tin này trong tài liệu đã upload.
```

### GET `/chat/history`

Protected. Returns the current user's chat history.

Response data shape is `ChatHistoryListResponse`.

### GET `/chat/history/:id`

Protected. Returns one chat history item owned by the current user.

Response data shape is `ChatHistoryResponse`.

### DELETE `/chat/history/:id`

Protected. Deletes one chat history item.

Response:

```json
{
  "success": true,
  "message": "Chat history deleted successfully"
}
```

## Evaluation Logs

### GET `/evaluation/logs`

Protected. Returns research logs for comparing basic vs corrective RAG.

### GET `/evaluation/summary`

Protected.

Response:

```json
{
  "success": true,
  "message": "Evaluation summary fetched successfully",
  "data": {
    "totalQuestions": 10,
    "averageRelevanceScore": 0.71,
    "averageConfidenceScore": 0.84,
    "averageResponseTime": 2200,
    "basicModeCount": 4,
    "correctiveModeCount": 6
  }
}
```

## RAG Test Flow

1. Start MongoDB and the backend, and make sure your Pinecone index exists.
2. Register or login to get `accessToken`.
3. Upload a PDF with `POST /api/documents/upload`.
4. Confirm Pinecone has chunks by checking the upload request succeeds; the upload flow now indexes chunks after saving the document.
5. Ask a basic question with `POST /api/chat/ask` and `"mode": "basic"`.
6. Ask the same question with `"mode": "corrective"`.
7. Compare `data.evaluation` in both responses.
8. Check saved history with `GET /api/chat/history`.
9. Check research logs with `GET /api/evaluation/logs`.
10. Check aggregate metrics with `GET /api/evaluation/summary`.

Example basic request:

```json
{
  "question": "Tài liệu nói gì về phương trình bậc hai?",
  "documentId": "665f2a...",
  "mode": "basic"
}
```

Example corrective request:

```json
{
  "question": "cái này dùng để làm gì",
  "documentId": "665f2a...",
  "mode": "corrective"
}
```

## Benchmark

Benchmark APIs compare Basic RAG and Corrective RAG against an expected answer.
All benchmark routes are protected.

### POST `/benchmark/questions`

Create one benchmark question.

```json
{
  "question": "What is supervised learning used for?",
  "expectedAnswer": "Supervised learning uses labeled examples to train a model to predict outputs for new inputs.",
  "subject": "Machine Learning",
  "documentId": "665f2a...",
  "difficulty": "medium"
}
```

### GET `/benchmark/questions`

Returns all benchmark questions created by the current user.

### GET `/benchmark/questions/:id`

Returns one benchmark question.

### PUT `/benchmark/questions/:id`

Updates one benchmark question.

```json
{
  "difficulty": "hard",
  "expectedAnswer": "Updated expected answer."
}
```

### DELETE `/benchmark/questions/:id`

Deletes one benchmark question.

### POST `/benchmark/run/:questionId`

Runs the same question through:

1. `mode = basic`
2. `mode = corrective`

Then Gemini evaluates both answers using:

- `answerCorrectness`
- `faithfulness`
- `relevance`
- `completeness`
- `overallScore`

Winner logic:

- Corrective wins if its score is at least `0.05` higher.
- Basic wins if its score is at least `0.05` higher.
- Otherwise result is `tie`.

Example response:

```json
{
  "success": true,
  "message": "Benchmark run completed successfully",
  "data": {
    "id": "666...",
    "benchmarkQuestionId": "665...",
    "question": "What is supervised learning used for?",
    "expectedAnswer": "Supervised learning uses labeled examples...",
    "basicAnswer": "Basic RAG answer...",
    "correctiveAnswer": "Corrective RAG answer...",
    "basicEvaluation": {
      "answerCorrectness": 0.7,
      "faithfulness": 0.8,
      "relevance": 0.75,
      "completeness": 0.65,
      "overallScore": 0.73,
      "explanation": "The answer is partially correct."
    },
    "correctiveEvaluation": {
      "answerCorrectness": 0.9,
      "faithfulness": 0.92,
      "relevance": 0.9,
      "completeness": 0.85,
      "overallScore": 0.89,
      "explanation": "The answer is accurate and complete."
    },
    "winner": "corrective"
  }
}
```

### GET `/benchmark/summary`

Example response:

```json
{
  "success": true,
  "message": "Benchmark summary fetched successfully",
  "data": {
    "totalRuns": 10,
    "basicAverageScore": 0.72,
    "correctiveAverageScore": 0.84,
    "correctiveWinRate": 0.7,
    "basicWinRate": 0.2,
    "tieRate": 0.1,
    "averageFaithfulnessImprovement": 0.11,
    "averageCorrectnessImprovement": 0.09
  }
}
```

Example benchmark questions:

```json
[
  {
    "question": "What is the main purpose of supervised learning?",
    "expectedAnswer": "It learns from labeled data to predict outputs for unseen inputs.",
    "difficulty": "easy"
  },
  {
    "question": "Why is normalization used before training a model?",
    "expectedAnswer": "Normalization scales features to comparable ranges, helping optimization converge more reliably.",
    "difficulty": "medium"
  },
  {
    "question": "Compare overfitting and underfitting based on the uploaded document.",
    "expectedAnswer": "Overfitting performs well on training data but poorly on new data, while underfitting fails to capture the underlying pattern in both training and test data.",
    "difficulty": "hard"
  }
]
```
