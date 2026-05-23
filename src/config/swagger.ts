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
              example: "ai-study-hub/documents/1710000000000-lesson",
            },
            fileName: { type: "string", example: "lesson.pdf" },
            fileType: { type: "string", example: "application/pdf" },
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
