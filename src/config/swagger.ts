import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AI Study Hub API",
      version: "1.0.0",
      description: "Backend API documentation for Phase 1 features.",
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Local development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ApiError: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string", example: "Validation error" },
            error: { type: "string", example: "Invalid request body" },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string", example: "665f1c9d2a5b6f0012a12345" },
            fullName: { type: "string", example: "Nguyen Gia Huy" },
            email: { type: "string", example: "huy@example.com" },
            avatar: { type: "string", example: "https://example.com/avatar.png" },
            role: { type: "string", enum: ["user", "admin"], example: "user" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        AuthResponseData: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            accessToken: { type: "string", example: "jwt-token" },
          },
        },
        Document: {
          type: "object",
          properties: {
            id: { type: "string", example: "665f2a9d2a5b6f0012a67890" },
            title: { type: "string", example: "Lesson 1" },
            description: { type: "string", example: "Algebra notes" },
            subject: { type: "string", example: "Math" },
            fileUrl: {
              type: "string",
              example: "https://res.cloudinary.com/demo/raw/upload/file.pdf",
            },
            filePublicId: {
              type: "string",
              example: "ai-study-hub/documents/1710000000000-lesson.pdf",
            },
            fileName: { type: "string", example: "lesson.pdf" },
            fileType: { type: "string", example: "application/pdf" },
            originalFileName: { type: "string", example: "lesson.pdf" },
            storedFileName: {
              type: "string",
              example: "1710000000000-lesson.pdf",
            },
            fileExtension: { type: "string", example: ".pdf" },
            mimeType: { type: "string", example: "application/pdf" },
            fileSize: { type: "number", example: 123456 },
            extractedText: { type: "string", example: "Extracted PDF text..." },
            uploadedBy: { type: "string", example: "665f1c9d2a5b6f0012a12345" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        DocumentListData: {
          type: "object",
          properties: {
            documents: {
              type: "array",
              items: { $ref: "#/components/schemas/Document" },
            },
            total: { type: "number", example: 1 },
          },
        },
        ChatSource: {
          type: "object",
          properties: {
            documentId: { type: "string", example: "665f2a9d2a5b6f0012a67890" },
            title: { type: "string", example: "Lesson 1" },
            chunkIndex: { type: "number", example: 0 },
            section: { type: "string", example: "INSTRUCTIONS" },
            contentPreview: {
              type: "string",
              example: "This chunk contains the relevant lesson content...",
            },
            relevanceScore: { type: "number", example: 0.82 },
          },
        },
        RagEvaluation: {
          type: "object",
          properties: {
            retrievedChunksCount: { type: "number", example: 8 },
            relevantChunksCount: { type: "number", example: 4 },
            averageRelevanceScore: { type: "number", example: 0.72 },
            correctiveAttempted: { type: "boolean", example: true },
            isGrounded: { type: "boolean", example: true },
            confidenceScore: { type: "number", example: 0.88 },
            responseTimeMs: { type: "number", example: 2450 },
            usedFallbackChunks: { type: "boolean", example: false },
            relevanceThreshold: { type: "number", example: 0.35 },
            warning: {
              type: "string",
              example:
                "Used fallback top retrieved chunks because relevance evaluator rejected all chunks.",
            },
            detectedIntent: { type: "string", example: "entity_extraction" },
            retrievedSections: {
              type: "array",
              items: { type: "string" },
              example: ["INSTRUCTIONS", "CONTENT"],
            },
          },
        },
        AskQuestionData: {
          type: "object",
          properties: {
            answer: {
              type: "string",
              example: "The answer based on uploaded documents.",
            },
            mode: { type: "string", enum: ["basic", "corrective"] },
            originalQuestion: {
              type: "string",
              example: "cái này dùng để làm gì",
            },
            rewrittenQuery: {
              type: "string",
              example:
                "Explain the purpose and usage of the concept mentioned in the uploaded study document.",
            },
            sources: {
              type: "array",
              items: { $ref: "#/components/schemas/ChatSource" },
            },
            evaluation: { $ref: "#/components/schemas/RagEvaluation" },
          },
        },
        BenchmarkEvaluationScore: {
          type: "object",
          properties: {
            answerCorrectness: { type: "number", example: 0.85 },
            faithfulness: { type: "number", example: 0.9 },
            relevance: { type: "number", example: 0.88 },
            completeness: { type: "number", example: 0.8 },
            overallScore: { type: "number", example: 0.86 },
            explanation: {
              type: "string",
              example: "The answer covers most expected points and is grounded.",
            },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Check API health",
          responses: {
            "200": {
              description: "API is running",
            },
          },
        },
      },
      "/api/auth/register": {
        post: {
          tags: ["Auth"],
          summary: "Register a new user",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["fullName", "email", "password"],
                  properties: {
                    fullName: { type: "string", example: "Nguyen Gia Huy" },
                    email: { type: "string", example: "huy@example.com" },
                    password: { type: "string", example: "password123" },
                    avatar: {
                      type: "string",
                      example: "https://example.com/avatar.png",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Registered successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: { type: "string", example: "Registered successfully" },
                      data: { $ref: "#/components/schemas/AuthResponseData" },
                    },
                  },
                },
              },
            },
            "400": { description: "Validation error" },
            "409": { description: "Email already exists" },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", example: "huy@example.com" },
                    password: { type: "string", example: "password123" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Logged in successfully",
            },
            "401": { description: "Invalid email or password" },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Logout",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Logged out successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Get current user",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Current user fetched successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/auth/profile": {
        put: {
          tags: ["Auth"],
          summary: "Update current user profile",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    fullName: { type: "string", example: "Huy Nguyen" },
                    avatar: {
                      type: "string",
                      example: "https://example.com/avatar.png",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Profile updated successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/auth/forgot-password": {
        post: {
          tags: ["Auth"],
          summary: "Request forgot password flow",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", example: "huy@example.com" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Forgot password request accepted" },
          },
        },
      },
      "/api/benchmark/questions": {
        post: {
          tags: ["Benchmark"],
          summary: "Create a benchmark question",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["question", "expectedAnswer", "difficulty"],
                  properties: {
                    question: {
                      type: "string",
                      example: "What is the purpose of supervised learning?",
                    },
                    expectedAnswer: {
                      type: "string",
                      example:
                        "Supervised learning learns from labeled examples to predict outputs for new inputs.",
                    },
                    subject: { type: "string", example: "Machine Learning" },
                    documentId: { type: "string", example: "665f2a..." },
                    difficulty: {
                      type: "string",
                      enum: ["easy", "medium", "hard"],
                      example: "medium",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Benchmark question created successfully" },
          },
        },
        get: {
          tags: ["Benchmark"],
          summary: "List benchmark questions",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Benchmark questions fetched successfully" },
          },
        },
      },
      "/api/benchmark/questions/{id}": {
        get: {
          tags: ["Benchmark"],
          summary: "Get benchmark question",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Benchmark question fetched successfully" },
            "404": { description: "Benchmark question not found" },
          },
        },
        put: {
          tags: ["Benchmark"],
          summary: "Update benchmark question",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Benchmark question updated successfully" },
          },
        },
        delete: {
          tags: ["Benchmark"],
          summary: "Delete benchmark question",
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Benchmark question deleted successfully" },
          },
        },
      },
      "/api/benchmark/run/{questionId}": {
        post: {
          tags: ["Benchmark"],
          summary: "Run basic vs corrective benchmark for one question",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "questionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "201": { description: "Benchmark run completed successfully" },
          },
        },
      },
      "/api/benchmark/summary": {
        get: {
          tags: ["Benchmark"],
          summary: "Get benchmark summary metrics",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Benchmark summary fetched successfully" },
          },
        },
      },
      "/api/chat/ask": {
        post: {
          tags: ["Chat"],
          summary: "Ask a question about uploaded documents",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["question"],
                  properties: {
                    question: {
                      type: "string",
                      example: "Tài liệu nói gì về phương trình bậc hai?",
                    },
                    documentId: {
                      type: "string",
                      example: "665f2a9d2a5b6f0012a67890",
                    },
                    subject: { type: "string", example: "Math" },
                    mode: {
                      type: "string",
                      enum: ["basic", "corrective"],
                      example: "corrective",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Question answered successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example: "Question answered successfully",
                      },
                      data: { $ref: "#/components/schemas/AskQuestionData" },
                    },
                  },
                },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/chat/history": {
        get: {
          tags: ["Chat"],
          summary: "List current user's chat history",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Chat history fetched successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/chat/history/{id}": {
        get: {
          tags: ["Chat"],
          summary: "Get one chat history item",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Chat history fetched successfully" },
            "404": { description: "Chat history not found" },
          },
        },
        delete: {
          tags: ["Chat"],
          summary: "Delete one chat history item",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Chat history deleted successfully" },
            "404": { description: "Chat history not found" },
          },
        },
      },
      "/api/evaluation/logs": {
        get: {
          tags: ["Evaluation"],
          summary: "List current user's RAG evaluation logs",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Evaluation logs fetched successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/evaluation/summary": {
        get: {
          tags: ["Evaluation"],
          summary: "Get RAG evaluation summary for current user",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Evaluation summary fetched successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/documents/upload": {
        post: {
          tags: ["Documents"],
          summary: "Upload a PDF document",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "title"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "PDF file, max 10MB",
                    },
                    title: { type: "string", example: "Lesson 1" },
                    description: { type: "string", example: "Algebra notes" },
                    subject: { type: "string", example: "Math" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Document uploaded successfully" },
            "400": { description: "Validation or file error" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/documents": {
        get: {
          tags: ["Documents"],
          summary: "List current user's documents",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Documents fetched successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example: "Documents fetched successfully",
                      },
                      data: { $ref: "#/components/schemas/DocumentListData" },
                    },
                  },
                },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/documents/search": {
        get: {
          tags: ["Documents"],
          summary: "Search current user's documents",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "keyword",
              in: "query",
              schema: { type: "string" },
              example: "algebra",
            },
            {
              name: "subject",
              in: "query",
              schema: { type: "string" },
              example: "Math",
            },
          ],
          responses: {
            "200": { description: "Documents searched successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/documents/{id}": {
        get: {
          tags: ["Documents"],
          summary: "Get one document",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Document fetched successfully" },
            "404": { description: "Document not found" },
          },
        },
        put: {
          tags: ["Documents"],
          summary: "Update document metadata",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string", example: "Updated Lesson 1" },
                    description: { type: "string", example: "Updated notes" },
                    subject: { type: "string", example: "Physics" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Document updated successfully" },
            "404": { description: "Document not found" },
          },
        },
        delete: {
          tags: ["Documents"],
          summary: "Delete document",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Document deleted successfully" },
            "404": { description: "Document not found" },
          },
        },
      },
    },
  },

  apis: ["./src/routes/*.ts"],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
