import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AI Study Hub API",
      version: "1.0.0",
      description:
        "Backend API documentation for AI Study Hub, including auth, core document domain, upload/RAG, chat, evaluation, and benchmark APIs.",
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
            _id: { type: "string", example: "665f2a9d2a5b6f0012a67890" },
            id: { type: "string", example: "665f2a9d2a5b6f0012a67890" },
            ownerId: { type: "string", example: "665f1c9d2a5b6f0012a12345" },
            title: { type: "string", example: "Lesson 1" },
            description: { type: "string", example: "Algebra notes" },
            subject: { type: "string", example: "WDP301" },
            subjectId: { $ref: "#/components/schemas/SubjectSummary" },
            visibility: {
              type: "string",
              enum: ["PUBLIC", "PRIVATE"],
              example: "PRIVATE",
            },
            status: {
              type: "string",
              enum: ["ACTIVE", "ARCHIVED", "DELETED"],
              example: "ACTIVE",
            },
            totalViews: { type: "number", example: 0 },
            totalDownloads: { type: "number", example: 0 },
            currentVersionId: {
              type: "string",
              nullable: true,
              example: null,
            },
            totalVersions: { type: "number", example: 3 },
            totalChunks: { type: "number", example: 12 },
            chunkingStrategy: {
              type: "string",
              enum: ["heading-based", "fixed-size-fallback"],
              example: "heading-based",
            },
            detectedSections: {
              type: "array",
              items: { type: "string" },
              example: ["Chương 1 Tổng quan", "Chương 2 Phương pháp"],
            },
            chapterCount: { type: "number", example: 2 },
            partCount: { type: "number", example: 0 },
            sectionCount: { type: "number", example: 2 },
            lastIndexedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            deletedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
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
            extractedText: {
              type: "string",
              example: "Extracted document text...",
            },
            extractionStatus: {
              type: "string",
              enum: ["COMPLETED", "FAILED"],
              example: "COMPLETED",
            },
            extractionError: {
              type: "string",
              example: "",
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Subject: {
          type: "object",
          properties: {
            _id: { type: "string", example: "665f2a9d2a5b6f0012a67891" },
            ownerId: { type: "string", example: "665f1c9d2a5b6f0012a12345" },
            name: { type: "string", example: "Web Development Project" },
            code: { type: "string", example: "WDP301" },
            description: {
              type: "string",
              example: "Materials and notes for WDP301.",
            },
            color: { type: "string", example: "#2563eb" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        SubjectSummary: {
          type: "object",
          properties: {
            _id: { type: "string", example: "665f2a9d2a5b6f0012a67891" },
            name: { type: "string", example: "Web Development Project" },
            code: { type: "string", example: "WDP301" },
            description: {
              type: "string",
              example: "Materials and notes for WDP301.",
            },
            color: { type: "string", example: "#2563eb" },
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
        DocumentListItem: {
          type: "object",
          properties: {
            _id: { type: "string", example: "665f2a9d2a5b6f0012a67890" },
            title: { type: "string", example: "Lesson 1" },
            description: { type: "string", example: "Algebra notes" },
            subject: { $ref: "#/components/schemas/SubjectSummary" },
            visibility: {
              type: "string",
              enum: ["PUBLIC", "PRIVATE"],
              example: "PRIVATE",
            },
            status: {
              type: "string",
              enum: ["ACTIVE", "ARCHIVED", "DELETED"],
              example: "ACTIVE",
            },
            fileUrl: {
              type: "string",
              example: "https://res.cloudinary.com/demo/raw/upload/file.pdf",
            },
            fileName: { type: "string", example: "lesson.pdf" },
            fileType: { type: "string", example: "application/pdf" },
            fileSize: { type: "number", example: 123456 },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        DocumentVersion: {
          type: "object",
          properties: {
            id: { type: "string", example: "665f2a9d2a5b6f0012a67999" },
            documentId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67890",
            },
            versionNumber: { type: "number", example: 2 },
            uploadMode: {
              type: "string",
              enum: ["OVERRIDE", "APPEND"],
              example: "OVERRIDE",
            },
            fileName: { type: "string", example: "lecture-week-3.pdf" },
            fileUrl: {
              type: "string",
              example: "https://res.cloudinary.com/demo/raw/upload/file.pdf",
            },
            fileType: { type: "string", example: "application/pdf" },
            fileSize: { type: "number", example: 123456 },
            fileExtension: { type: "string", example: ".pdf" },
            extractionStatus: {
              type: "string",
              enum: ["PENDING", "EXTRACTING", "COMPLETED", "FAILED"],
              example: "COMPLETED",
            },
            extractionError: { type: "string", example: "" },
            processingStatus: {
              type: "string",
              enum: ["PENDING", "PROCESSING", "INDEXED", "FAILED"],
              example: "INDEXED",
            },
            processingStage: {
              type: "string",
              enum: [
                "UPLOADED",
                "EXTRACTING_TEXT",
                "CHUNKING",
                "EMBEDDING",
                "UPSERTING_VECTOR",
                "COMPLETED",
                "FAILED",
              ],
              example: "UPLOADED",
            },
            processingProgress: { type: "number", example: 100 },
            processingError: { type: "string", example: "" },
            processingStartedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            processingCompletedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            uploadSessionId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67000",
            },
            totalChunks: { type: "number", example: 12 },
            chunkingStrategy: {
              type: "string",
              enum: ["heading-based", "fixed-size-fallback"],
              example: "heading-based",
            },
            detectedSections: {
              type: "array",
              items: { type: "string" },
              example: ["Chương 1 Tổng quan", "Chương 2 Phương pháp"],
            },
            chapterCount: { type: "number", example: 2 },
            partCount: { type: "number", example: 0 },
            sectionCount: { type: "number", example: 2 },
            indexedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            isActive: { type: "boolean", example: true },
            uploadedBy: {
              type: "string",
              example: "665f1c9d2a5b6f0012a12345",
            },
            uploadReason: {
              type: "string",
              example: "Update lecture note week 3",
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            extractedText: {
              type: "string",
              example: "Included only when includeText=true.",
            },
          },
        },
        UploadSession: {
          type: "object",
          properties: {
            uploadSessionId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67000",
            },
            documentId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67890",
            },
            versionId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67999",
            },
            status: {
              type: "string",
              enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
              example: "PROCESSING",
            },
            stage: {
              type: "string",
              enum: [
                "UPLOADED",
                "EXTRACTING_TEXT",
                "CHUNKING",
                "EMBEDDING",
                "UPSERTING_VECTOR",
                "COMPLETED",
                "FAILED",
              ],
              example: "EMBEDDING",
            },
            progress: { type: "number", example: 60 },
            message: { type: "string", example: "Generating embeddings" },
            errorMessage: { type: "string", nullable: true, example: null },
            completedAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        UploadProgressEvent: {
          type: "object",
          properties: {
            documentId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67890",
            },
            uploadSessionId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67000",
            },
            versionId: {
              type: "string",
              example: "665f2a9d2a5b6f0012a67999",
            },
            status: {
              type: "string",
              enum: ["processing", "completed", "failed"],
              example: "processing",
            },
            progress: { type: "number", example: 60 },
            step: { type: "string", example: "EMBEDDING" },
            message: { type: "string", example: "Generating embeddings" },
          },
        },
        Pagination: {
          type: "object",
          properties: {
            page: { type: "number", example: 1 },
            limit: { type: "number", example: 10 },
            totalItems: { type: "number", example: 35 },
            totalPages: { type: "number", example: 4 },
          },
        },
        PaginatedDocumentListData: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/DocumentListItem" },
            },
            pagination: { $ref: "#/components/schemas/Pagination" },
          },
        },
        ChatSource: {
          type: "object",
          properties: {
            documentId: { type: "string", example: "665f2a9d2a5b6f0012a67890" },
            title: { type: "string", example: "Lesson 1" },
            chunkIndex: { type: "number", example: 0 },
            section: { type: "string", example: "Course Overview" },
            inferredSection: { type: "string", example: "Course Overview" },
            semanticSectionLabel: { type: "string", example: "Course Overview" },
            heading: { type: "string", example: "Chapter 2" },
            sectionTitle: { type: "string", example: "Chapter 2" },
            sectionIndex: { type: "number", example: 2 },
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
            relevanceThreshold: { type: "number", example: 0.55 },
            warning: {
              type: "string",
              example:
                "Generated answer was not well supported by document context.",
            },
            fallbackGenerated: { type: "boolean", example: false },
            fallbackReason: {
              type: "string",
              example: "grounding_failed",
            },
            detectedIntent: { type: "string", example: "extraction" },
            retrievedSections: {
              type: "array",
              items: { type: "string" },
              example: ["Course Overview", "Practice Questions"],
            },
            answerProfile: {
              type: "string",
              enum: ["brief", "standard", "detailed"],
              example: "detailed",
            },
            usedSectionExpansion: { type: "boolean", example: true },
            selectedSectionTitle: { type: "string", example: "Chapter 2" },
            contextChunksUsed: { type: "number", example: 12 },
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
                    subjectId: {
                      type: "string",
                      example: "665f2a9d2a5b6f0012a67891",
                    },
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
      "/api/subjects": {
        post: {
          tags: ["Subjects"],
          summary: "Create a subject",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string",
                      example: "Web Development Project",
                    },
                    code: { type: "string", example: "WDP301" },
                    description: {
                      type: "string",
                      example: "Materials and notes for WDP301.",
                    },
                    color: { type: "string", example: "#2563eb" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Subject created successfully" },
            "409": { description: "Subject name or code already exists" },
          },
        },
        get: {
          tags: ["Subjects"],
          summary: "List current user's subjects",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "number", default: 1 },
              example: 1,
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "number", default: 10, maximum: 50 },
              example: 10,
            },
            {
              name: "search",
              in: "query",
              schema: { type: "string" },
              example: "WDP",
            },
          ],
          responses: {
            "200": { description: "Subjects fetched successfully" },
          },
        },
      },
      "/api/subjects/{id}": {
        get: {
          tags: ["Subjects"],
          summary: "Get one subject",
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
            "200": { description: "Subject fetched successfully" },
            "404": { description: "Subject not found" },
          },
        },
        put: {
          tags: ["Subjects"],
          summary: "Update a subject",
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
                    name: {
                      type: "string",
                      example: "Web Development Project",
                    },
                    code: { type: "string", example: "WDP301" },
                    description: {
                      type: "string",
                      example: "Updated subject description.",
                    },
                    color: { type: "string", example: "#16a34a" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Subject updated successfully" },
            "404": { description: "Subject not found" },
            "409": { description: "Subject name or code already exists" },
          },
        },
        delete: {
          tags: ["Subjects"],
          summary: "Delete a subject",
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
            "200": { description: "Subject deleted successfully" },
            "409": { description: "Subject is being used by documents" },
          },
        },
      },
      "/api/documents/upload": {
        post: {
          tags: ["Documents"],
          summary: "Upload a study document",
          description:
            "Supported file types: PDF, DOCX, PPTX, XLSX, TXT, and MD. Uploaded files are normalized to plain text before chunking, embeddings, and Pinecone indexing.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "title", "subjectId"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description:
                        "PDF, DOCX, PPTX, XLSX, TXT, or MD file, max 10MB",
                    },
                    title: { type: "string", example: "Lesson 1" },
                    description: { type: "string", example: "Algebra notes" },
                    subjectId: {
                      type: "string",
                      example: "665f2a9d2a5b6f0012a67891",
                    },
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
        post: {
          tags: ["Documents"],
          summary: "Create document metadata",
          description:
            "Creates the core Document entity without uploading a file. File upload, processing, and versioning are handled by separate flows/phases.",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "subjectId"],
                  properties: {
                    title: { type: "string", example: "React Hooks" },
                    description: { type: "string", example: "Week 3" },
                    subjectId: {
                      type: "string",
                      example: "665f2a9d2a5b6f0012a67891",
                    },
                    visibility: {
                      type: "string",
                      enum: ["PUBLIC", "PRIVATE"],
                      example: "PRIVATE",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Document created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example: "Document created successfully",
                      },
                      data: { $ref: "#/components/schemas/Document" },
                    },
                  },
                },
              },
            },
            "400": { description: "Subject not found or validation error" },
            "401": { description: "Unauthorized" },
          },
        },
        get: {
          tags: ["Documents"],
          summary: "List readable documents with filters and pagination",
          description:
            "Returns documents owned by the current user plus PUBLIC documents. DELETED documents are excluded by default.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "number", default: 1 },
              example: 1,
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "number", default: 10, maximum: 50 },
              example: 10,
            },
            {
              name: "subjectId",
              in: "query",
              schema: { type: "string" },
              example: "665f2a9d2a5b6f0012a67891",
            },
            {
              name: "keyword",
              in: "query",
              schema: { type: "string" },
              example: "react",
            },
            {
              name: "visibility",
              in: "query",
              schema: {
                type: "string",
                enum: ["PUBLIC", "PRIVATE"],
              },
              example: "PUBLIC",
            },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["ACTIVE", "ARCHIVED"],
              },
              example: "ACTIVE",
            },
          ],
          responses: {
            "200": {
              description: "Documents fetched successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PaginatedDocumentListData" },
                },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/documents/subjects": {
        get: {
          tags: ["Documents"],
          summary: "List available document subjects",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Get subjects successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example: "Get subjects successfully",
                      },
                      data: {
                        type: "array",
                        items: { type: "string" },
                        example: ["DBI202", "PRM392", "WDP301"],
                      },
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
              name: "subjectId",
              in: "query",
              schema: { type: "string" },
              example: "665f2a9d2a5b6f0012a67891",
            },
          ],
          responses: {
            "200": { description: "Documents searched successfully" },
            "401": { description: "Unauthorized" },
          },
        },
      },
      "/api/documents/{documentId}/reindex": {
        post: {
          tags: ["Documents"],
          summary: "Reindex document chunks",
          description:
            "Deletes old Pinecone vectors, regenerates heading-based chunks, regenerates embeddings, and upserts fresh vectors.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Document reindexed successfully" },
            "404": { description: "Document not found" },
          },
        },
      },
      "/api/documents/{documentId}/versions": {
        post: {
          tags: ["Document Versions"],
          summary: "Upload first or new document version",
          description:
            "Uploads a concrete file version for a logical document, creates an UploadSession, processes extraction/chunking/embedding/indexing synchronously, and emits Socket.IO upload progress events. OVERRIDE always marks the new version as active. APPEND supports makeActive, default true.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "uploadMode"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description:
                        "PDF, DOCX, PPTX, XLSX, TXT, or MD file, max 10MB",
                    },
                    uploadMode: {
                      type: "string",
                      enum: ["OVERRIDE", "APPEND"],
                      example: "OVERRIDE",
                    },
                    uploadReason: {
                      type: "string",
                      maxLength: 500,
                      example: "Update lecture note week 3",
                    },
                    makeActive: {
                      type: "boolean",
                      example: true,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Document uploaded and indexed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example:
                          "Document uploaded and indexed successfully",
                      },
                      data: { $ref: "#/components/schemas/DocumentVersion" },
                    },
                  },
                },
              },
            },
            "409": { description: "CANNOT_UPLOAD_TO_ARCHIVED_DOCUMENT" },
            "422": { description: "EXTRACTION_FAILED" },
          },
        },
        get: {
          tags: ["Document Versions"],
          summary: "List document versions",
          description:
            "Owner can see all versions. Public viewers can see only active version metadata.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "page",
              in: "query",
              schema: { type: "number", default: 1 },
              example: 1,
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "number", default: 10, maximum: 50 },
              example: 10,
            },
          ],
          responses: {
            "200": {
              description: "Document versions fetched successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example: "Document versions fetched successfully",
                      },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/DocumentVersion" },
                      },
                      pagination: { $ref: "#/components/schemas/Pagination" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/documents/{documentId}/versions/{versionId}": {
        get: {
          tags: ["Document Versions"],
          summary: "Get document version detail",
          description:
            "extractedText is omitted unless includeText=true. Public viewers can only access active version.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "versionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "includeText",
              in: "query",
              schema: { type: "boolean" },
              example: false,
            },
          ],
          responses: {
            "200": { description: "Document version fetched successfully" },
            "404": { description: "VERSION_NOT_FOUND" },
          },
        },
        delete: {
          tags: ["Document Versions"],
          summary: "Soft delete non-active document version",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "versionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Document version deleted successfully" },
            "409": { description: "CANNOT_DELETE_ACTIVE_VERSION" },
          },
        },
      },
      "/api/documents/{documentId}/versions/{versionId}/reindex": {
        post: {
          tags: ["Document Versions"],
          summary: "Reindex document version",
          description:
            "Owner only. Creates an UploadSession, re-chunks extracted text, regenerates embeddings, upserts Pinecone vectors, and emits Socket.IO upload progress events.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "versionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Document version reindexed successfully",
            },
            "404": { description: "VERSION_NOT_FOUND" },
          },
        },
      },
      "/api/documents/{documentId}/versions/{versionId}/activate": {
        patch: {
          tags: ["Document Versions"],
          summary: "Set active document version",
          description:
            "Owner only. Deactivates other versions, updates Document.currentVersionId, and reindexes the active version through the existing RAG pipeline.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "versionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Document version activated successfully" },
            "404": { description: "VERSION_NOT_FOUND" },
          },
        },
      },
      "/api/upload-sessions/{uploadSessionId}": {
        get: {
          tags: ["Upload Sessions"],
          summary: "Get upload session processing status",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "uploadSessionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Upload session status fetched successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: true },
                      message: {
                        type: "string",
                        example: "Upload session status fetched successfully",
                      },
                      data: { $ref: "#/components/schemas/UploadSession" },
                    },
                  },
                },
              },
            },
            "404": { description: "Upload session not found" },
          },
        },
      },
      "/api/debug/documents/{documentId}/chunks": {
        get: {
          tags: ["Debug"],
          summary: "Preview generated document chunks",
          description:
            "Returns heading-based chunk previews for a document without writing vectors to Pinecone. If no headings are detected, chunkingStrategy is fixed-size-fallback.",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: "documentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Document chunks generated successfully" },
            "404": { description: "Document not found" },
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
                    subjectId: {
                      type: "string",
                      example: "665f2a9d2a5b6f0012a67891",
                    },
                    visibility: {
                      type: "string",
                      enum: ["PUBLIC", "PRIVATE"],
                      example: "PUBLIC",
                    },
                    status: {
                      type: "string",
                      enum: ["ACTIVE", "ARCHIVED"],
                      example: "ARCHIVED",
                    },
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
          summary: "Soft delete document",
          description:
            "Does not remove the MongoDB document. Sets status to DELETED and deletedAt to the current date.",
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

  apis: ["./src/routes/*.ts", "./src/modules/**/*.routes.ts"],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
