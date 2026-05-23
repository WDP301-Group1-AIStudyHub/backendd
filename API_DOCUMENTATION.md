# AI Study Hub Phase 1 API

Base URL: `http://localhost:5000/api`

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
