# API Contract — Tóm tắt tài liệu bằng AI + Chia sẻ bản tóm tắt

**Backend: Duy · Frontend (Web + Mobile): Tài**
Chốt theo codebase thật, ngày 05/08/2026. Thay thế sheet `API Contract` trong `Phan_cong_AI_Summary_Duy_Tai.xlsx`.

> Sheet gốc ghi: *"Duy chốt lại tên field/route theo codebase thật trước khi code."* Đây là bản chốt đó.
> Mục [§8 Khác biệt so với file Excel](#8-khác-biệt-so-với-file-excel) liệt kê **toàn bộ** chỗ lệch — đọc mục đó trước khi code.
> Sau bản này: không tự ý đổi field mà không báo trước.

---

## 1. Quy ước chung

**Base URL:** `/api` — mọi route dưới đây đều đã có sẵn prefix này.

**Auth:** tất cả endpoint đều qua `authMiddleware`. Gửi `Authorization: Bearer <accessToken>`.

### 1.1. Response envelope — QUAN TRỌNG

File Excel viết response dạng body trần (`{ "artifactId": ..., "status": ... }`).
**Thực tế backend bọc mọi response trong envelope chung:**

```jsonc
{
  "success": true,
  "message": "Summary generation started in background",
  "data": { /* ... nội dung thật nằm ở đây ... */ }
}
```

→ Tài đọc dữ liệu ở `res.data.data`, không phải `res.data`.

### 1.2. Error envelope

```jsonc
{
  "success": false,
  "message": "Only the document owner can create a summary.",
  "code": "FORBIDDEN_NOT_OWNER",   // optional — chỉ có ở lỗi đã định nghĩa code
  "details": { },                  // optional — xem từng endpoint
  "debug": { "name": "AppError", "message": "..." }
}
```

Bắt lỗi theo `code` (machine-readable), **không** parse `message` (prose, có thể đổi).

### 1.3. Định danh

Backend dùng MongoDB `_id`. Object artifact trả về có field `_id`, **không** có `artifactId`.

---

## 2. Tạo bản tóm tắt

### `POST /api/documents/:id/summaries`

**Request body:** không có. Gửi body rỗng. Một kiểu tóm tắt cố định, không tham số, không preset.
(RULE-02 không áp dụng — không có ô nhập cho user gõ.)

**Điều kiện:** chỉ **chủ sở hữu tài liệu** gọi được. Chặn ở tầng API, không phải chỉ ẩn nút.

#### `202 Accepted` — bắt đầu tạo mới (đã trừ 1 lượt quota)

```jsonc
{
  "success": true,
  "message": "Summary generation started in background",
  "data": {
    "_id": "66b0f1c2e4b0a1234567890a",     // artifactId — dùng cho polling & share
    "userId": "66a0...",
    "type": "SUMMARY",
    "status": "PENDING",
    "title": "Operating Systems chapter 3", // = title của document
    "sourceDocumentIds": ["66c1..."],
    "summaryDocumentId": "66c1...",         // documentId của tài liệu được tóm tắt
    "subjectId": "66d2...",
    "scope": "single_document",
    "sources": [],
    "createdAt": "2026-08-05T10:12:00.000Z",
    "updatedAt": "2026-08-05T10:12:00.000Z",
    "cached": false                          // false = vừa tiêu 1 prompt
  }
}
```

#### `200 OK` — tài liệu đã có tóm tắt (KHÔNG trừ quota)

Cùng shape, nhưng `"cached": true` và `status` là trạng thái hiện tại (`PENDING` / `GENERATING` / `COMPLETED`).

> **Phân biệt bằng HTTP status code:** `202` = vừa tốn 1 lượt · `200` = không tốn lượt nào.
> Hoặc đọc field `cached`. Hai cái luôn khớp nhau.

**Không có re-generate.** Bấm lại lần 2 trên tài liệu đã có tóm tắt luôn trả `200 + cached: true`, không bao giờ gọi AI, không bao giờ trừ quota. Ngoại lệ duy nhất: bản tóm tắt trước đó `FAILED` → bấm lại sẽ chạy lại và **có** trừ quota (trả `202`).

#### `403 Forbidden` — không phải owner

```jsonc
{
  "success": false,
  "message": "Only the document owner can create a summary.",
  "code": "FORBIDDEN_NOT_OWNER"
}
```

Áp dụng cho cả admin và người được chia sẻ. Không có ngoại lệ.

#### `429 Too Many Requests` — hết quota

```jsonc
{
  "success": false,
  "message": "Weekly free quota exhausted. Add an API key to continue.",
  "code": "QUOTA_EXHAUSTED_NO_KEY",       // hoặc QUOTA_EXHAUSTED_INVALID_KEY
  "details": {
    "remaining": 0,
    "limit": 15,
    "resetAt": "2026-08-10T00:00:00.000Z"
  }
}
```

| `code` | Ý nghĩa | UI gợi ý |
|---|---|---|
| `QUOTA_EXHAUSTED_NO_KEY` | Hết 15 lượt/tuần, chưa có API key riêng | Dẫn sang màn hình nhập API key (T8/T11) |
| `QUOTA_EXHAUSTED_INVALID_KEY` | Hết lượt, và API key đã lưu bị lỗi | Báo key hỏng + dẫn sang màn hình sửa key |

#### `400 Bad Request` — tài liệu chưa đọc được

```jsonc
{
  "success": false,
  "message": "This document has no readable text yet. Wait for processing to finish, or upload a text-based copy.",
  "code": "DOCUMENT_NOT_READABLE"
}
```

Xảy ra khi tài liệu chưa extract xong text, hoặc là file scan/ảnh chưa OCR. **Không trừ quota.**

#### `404 Not Found`
Tài liệu không tồn tại hoặc đã bị xoá.

---

## 3. Polling trạng thái

### `GET /api/artifacts/:id`

`:id` là `_id` của artifact lấy từ bước 2. Endpoint này **cả owner lẫn người được chia sẻ đều gọi được**.

```jsonc
{
  "success": true,
  "message": "Artifact fetched successfully",
  "data": {
    "_id": "66b0f1c2e4b0a1234567890a",
    "type": "SUMMARY",
    "status": "COMPLETED",
    "title": "Operating Systems chapter 3",
    "content": {
      "markdown": "# Tóm tắt\n\nTài liệu trình bày...\n\n## Key points\n- ...\n"
    },
    "summaryDocumentId": "66c1...",
    "sources": [
      {
        "documentId": "66c1...",
        "title": "Operating Systems chapter 3",
        "chunkIndex": 0,
        "contentPreview": "..."
      }
    ],
    "error": null,
    "createdAt": "...",
    "updatedAt": "...",
    "isOwner": true          // false = đang xem bản được share
  }
}
```

### 3.1. Giá trị `status` — KHÁC file Excel

| Backend trả về | File Excel ghi nhầm là | Ý nghĩa |
|---|---|---|
| `PENDING` | `PENDING` | Đã nhận request, chờ worker |
| `GENERATING` | ~~`PROCESSING`~~ | Worker đang gọi AI |
| `COMPLETED` | ~~`DONE`~~ | Xong — đọc `content.markdown` |
| `FAILED` | ~~`ERROR`~~ | Lỗi — đọc `error` để hiện thông báo |

**Dùng đúng 4 giá trị cột trái.** Đây là enum có sẵn trong DB, không đổi được vì các artifact khác (FLASHCARD/QUIZ/MINDMAP/REPORT) đang dùng chung.

### 3.2. Nội dung tóm tắt

`content` là `{ "markdown": "..." }` — chuỗi GitHub-flavored markdown, render bằng markdown renderer.
Chỉ có khi `status === "COMPLETED"`; các trạng thái khác `content` là `null`/vắng mặt.

Cấu trúc AI sinh ra: 1 đoạn overview → mục `## Key points` (5–8 bullet) → 1 câu takeaway. Cùng ngôn ngữ với tài liệu gốc (tài liệu tiếng Việt → tóm tắt tiếng Việt).

### 3.3. Polling

Poll `GET /api/artifacts/:id` cho tới khi `status` là `COMPLETED` hoặc `FAILED`.
Gợi ý: 2s/lần, timeout ~90s. Đúng pattern REPORT đang chạy ổn.

### 3.4. `404`
Không tồn tại, **hoặc** người gọi không phải owner và cũng không được share.

---

## 4. Hiện / ẩn nút "Tóm tắt bằng AI"

### `GET /api/documents/:id` (endpoint có sẵn, đã bổ sung field)

Response `data` giờ có thêm:

```jsonc
{
  "isOwner": true,          // MỚI — dùng field này để quyết định render nút
  "accessRole": "OWNER",    // đã có sẵn — ĐỪNG dùng cho nút tóm tắt (xem cảnh báo)
  "isShared": false,
  "ownerId": "66a0..."
}
```

> ⚠️ **Dùng `isOwner`, không dùng `accessRole === "OWNER"`.**
> `accessRole` trả `"OWNER"` cho cả **admin** và **chủ subject workspace**, không chỉ người upload.
> `isOwner` là so sánh nghiêm ngặt `document.ownerId === user hiện tại` — đúng với ý đồ chống lách quota của RULE-01, và khớp chính xác với điều kiện backend chặn ở §2.

**Quy tắc render (theo bảng phân quyền sheet `Tong quan`):**

| `isOwner` | Tài liệu đã có tóm tắt? | Hiển thị |
|---|---|---|
| `true` | Chưa | Tài liệu + nút **"Tóm tắt bằng AI"** + số lượt còn lại |
| `true` | Rồi | Tài liệu + bản tóm tắt. **Không** hiện nút (không cho re-generate) |
| `false` | Chưa | **Chỉ** tài liệu. Không nút, không quota |
| `false` | Rồi | Tài liệu + bản tóm tắt. Không nút, không quota |

Khi `isOwner === false`: **không render nút vào DOM**, không phải ẩn bằng CSS.

> Backend vẫn chặn độc lập ở §2 — UI ẩn nút là để UX, không phải để bảo mật.

---

## 5. Chia sẻ bản tóm tắt

Chỉ **owner của artifact** gọi được cả 3 endpoint quản lý dưới đây. Người được share không share tiếp được (`404`).

### 5.1. `POST /api/artifacts/:id/shares`

**Request:**

```jsonc
{
  "email": "ban@example.com",
  "permission": "VIEW"        // optional, mặc định "VIEW" — chỉ nhận đúng "VIEW"
}
```

> **Khác file Excel:** chia sẻ theo **`email`** (1 người/lần), không phải `userIds[]`, và không có field `inviteType`.
> Lý do: tái dùng đúng shape của `DocumentShare` đang chạy. Picker chọn user của Tài chỉ cần gửi `email` của người được chọn.
> Muốn mời nhiều người → gọi lặp, mỗi người 1 request.

**`201 Created`:**

```jsonc
{
  "success": true,
  "message": "Summary shared successfully",
  "data": {
    "id": "66e3...",                    // shareId
    "artifactId": "66b0...",
    "sharedWithUser": {
      "id": "66a9...",
      "fullName": "Nguyễn Văn A",
      "email": "ban@example.com",
      "avatar": "https://..."
    },
    "permission": "VIEW",
    "sharedBy": "66a0...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Share lại cùng một email = idempotent, cập nhật bản ghi cũ, không tạo trùng.

**Lỗi:**

| Status | `code` | Khi nào |
|---|---|---|
| `404` | `RECIPIENT_NOT_FOUND` | Email chưa có tài khoản trong hệ thống |
| `400` | — | Tự share cho chính mình |
| `404` | — | Artifact không tồn tại hoặc người gọi không phải owner |

> **Chỉ mời được user đã có tài khoản** (đúng quyết định "Mời user trong hệ thống"). Không có luồng invitation qua email cho người lạ như `DocumentShare`.
> **Hiện chưa gửi email thông báo** cho người được share — họ thấy bản tóm tắt trong màn hình §5.3. Nếu cần gửi email, báo Duy.

### 5.2. `GET /api/artifacts/:id/shares`

Danh sách người đã được chia sẻ. `data` là **mảng** object giống hệt §5.1, sort mới nhất trước.

### 5.3. `GET /api/artifacts/shared-with-me`

Danh sách bản tóm tắt người khác chia sẻ cho mình.

```jsonc
{
  "success": true,
  "message": "Shared summaries fetched successfully",
  "data": [
    {
      "artifact": {
        "_id": "66b0...",
        "type": "SUMMARY",
        "status": "COMPLETED",
        "title": "Operating Systems chapter 3",
        "content": { "markdown": "..." },
        "summaryDocumentId": "66c1...",
        "createdAt": "..."
      },
      "sharedBy": {
        "id": "66a0...",
        "fullName": "Trần Thị B",
        "email": "chu@example.com",
        "avatar": "https://..."
      },
      "sharedAt": "2026-08-05T11:00:00.000Z"
    }
  ]
}
```

Xem được nội dung tóm tắt **mà không cần quyền gì trên tài liệu gốc**.
Màn hình này **tuyệt đối không có nút "Tóm tắt bằng AI"**, và cũng không có nút share tiếp.

> `summaryDocumentId` có trong payload, nhưng người nhận **không** chắc mở được `GET /api/documents/:id` của tài liệu đó — chỉ share summary thì không kèm quyền đọc tài liệu gốc. Đừng link sang trang document detail từ màn hình này trừ khi đã kiểm tra quyền.

### 5.4. `DELETE /api/artifacts/:id/shares/:shareId`

Thu hồi quyền xem. Owner only. Trả `200` + `message`, không có `data`.

> Endpoint này **không có trong file Excel** — thêm vào cho khớp pattern `DocumentShare` (có list thì phải có revoke). Dùng hay không tuỳ Tài.

---

## 6. Quota AI

### `GET /api/ai/usage`

> **Khác file Excel:** route là `GET /api/ai/usage`, **không** phải `GET /users/me/ai-quota`.
> Endpoint này đã tồn tại từ trước (feature BYOK), tái dùng luôn thay vì tạo route trùng chức năng.

```jsonc
{
  "success": true,
  "message": "AI usage retrieved successfully",
  "data": {
    "period": "2026-W32",                    // khoá tuần ISO
    "used": 3,
    "limit": 15,
    "remaining": 12,                          // MỚI
    "resetAt": "2026-08-10T00:00:00.000Z",   // MỚI — thứ Hai kế tiếp, 00:00 UTC
    "unlimited": false,
    "degraded": false,
    "unlimitedReason": null                   // "byok" | "exempt" | null
  }
}
```

| Field | Dùng để |
|---|---|
| `remaining` / `limit` | Hiện "Còn 12/15 lượt tuần này". **Không hiện token** (RULE-04) |
| `resetAt` | Đếm ngược "reset sau N ngày" |
| `unlimited` | `true` → ẩn hẳn phần đếm lượt, không disable nút |
| `unlimitedReason` | `"byok"` = user đã nhập API key riêng · `"exempt"` = admin |
| `degraded` | `true` → API key riêng của user đang lỗi, nên nhắc sửa |

**Chỉ hiện quota ở view của owner** — người được share không tiêu quota nên không cần thấy.

### 6.1. Bộ đếm — điểm cần lưu ý

- **Tuần, không phải tháng.** Trước đây backend đếm theo tháng; đã đổi sang tuần ISO (T2 → CN, reset 00:00 UTC thứ Hai) để khớp RULE-01.
- **Dùng chung 1 bộ đếm** cho: Hỏi đáp AI (chat), agent, và nút Tóm tắt. Bấm tóm tắt 1 lần = 1 prompt, y hệt gửi 1 câu hỏi chat.
- **Cache hit không tốn lượt** — xem §2.
- Quota chỉ được **enforce** khi biến môi trường `ENFORCE_BYOK_QUOTA=true`. Ở môi trường dev nếu tắt cờ này thì không bao giờ nhận `429` — không phải bug.

---

## 7. Luồng hoàn chỉnh (Web & Mobile)

```
1. Mở trang chi tiết tài liệu
   GET /api/documents/:id
   → data.isOwner === false  → render tài liệu, DỪNG. Không nút, không quota.
   → data.isOwner === true   → sang bước 2

2. Đã có tóm tắt chưa?
   (giữ artifactId ở state của Tài, hoặc gọi POST luôn ở bước 3 —
    POST trả 200 + cached:true nếu đã có, nên gọi thẳng cũng an toàn)

3. Hiện quota:  GET /api/ai/usage
   → remaining === 0 && !unlimited  → disable nút, dẫn sang màn hình API key

4. Bấm "Tóm tắt bằng AI"
   → disable nút NGAY (RULE-03: tránh double-submit trừ quota oan)
   POST /api/documents/:id/summaries      (body rỗng)
   → 202  → lưu data._id, sang bước 5, refresh lại quota
   → 200  → đã có sẵn, hiện luôn data.content.markdown
   → 403/429/400 → hiện lỗi theo `code`

5. Polling:  GET /api/artifacts/:id  mỗi 2s
   → COMPLETED → render content.markdown, hiện nút copy/export + nút Chia sẻ
   → FAILED    → hiện `error`, cho phép bấm lại (lần bấm lại NÀY có trừ quota)

6. Chia sẻ (chỉ owner):
   POST   /api/artifacts/:id/shares   { email, permission: "VIEW" }
   GET    /api/artifacts/:id/shares   → danh sách đã share
   DELETE /api/artifacts/:id/shares/:shareId

7. Màn hình "Summary được chia sẻ với tôi":
   GET /api/artifacts/shared-with-me
   → render danh sách + nội dung. KHÔNG nút tóm tắt, KHÔNG nút share.
```

---

## 8. Khác biệt so với file Excel

| # | File Excel | Thực tế | Lý do |
|---|---|---|---|
| 1 | Response là body trần | Bọc trong `{ success, message, data }` | Envelope chung của toàn bộ API, không đổi riêng cho feature này |
| 2 | `artifactId` | `_id` | Convention MongoDB, dùng chung với FLASHCARD/QUIZ/... |
| 3 | `status: DONE\|PROCESSING\|ERROR` | `COMPLETED\|GENERATING\|FAILED` | Enum có sẵn trong DB, dùng chung với các artifact khác |
| 4 | `GET /users/me/ai-quota` | `GET /api/ai/usage` | Endpoint đã tồn tại sẵn (BYOK), tái dùng |
| 5 | Response quota có `used/limit/resetAt` | Thêm `remaining`, `unlimited`, `degraded`, `unlimitedReason` | Có sẵn từ BYOK + tiện cho UI |
| 6 | Share: `{ inviteType, userIds[], permission }` | `{ email, permission }` — 1 người/lần | Tái dùng đúng pattern `DocumentShare` |
| 7 | 3.1b "cần có field `isOwner`" | Đã thêm `isOwner` vào `GET /api/documents/:id` | Đúng yêu cầu. Lưu ý §4: đừng dùng `accessRole` thay thế |
| 8 | `cached` nằm ở response `GET /artifacts/:id` | `cached` nằm ở response `POST .../summaries` | Ở GET thì `cached` luôn true → vô nghĩa. Ở POST nó trả lời đúng câu "lần bấm này có tốn lượt không" |
| 9 | (không có) | Thêm `DELETE /api/artifacts/:id/shares/:shareId` | Khớp pattern `DocumentShare` |
| 10 | Route không có prefix | Mọi route có prefix `/api` | Cấu hình app hiện tại |
| 11 | RULE-01 "15 prompt/tuần" | Đã đổi bộ đếm từ **tháng** sang **tuần ISO**, limit 15 | Trước đó backend đếm theo tháng (limit 20) |

### Mục đã chốt thêm (sheet `Tong quan` để mở)

| Mục | Quyết định |
|---|---|
| Owner có được tóm tắt lại (re-generate)? | **Không.** Bấm lại → `200 + cached:true`, không tốn quota. Ngoại lệ: bản `FAILED` được chạy lại và có trừ quota |
| Cache hit có trừ quota không? | **Không trừ** |
| Tài liệu có version mới thì sao? | Bản tóm tắt cũ **vẫn giữ nguyên**, không tự sinh lại. Nếu cần invalidate theo version → yêu cầu riêng, chưa làm |

---

## 9. Ghi chú cho Duy (backend)

- Migration: bản ghi `aiusages` cũ có `period` dạng `"2026-08"` sẽ không còn khớp khoá tuần `"2026-W32"` → mọi user bắt đầu tuần mới từ 0. Không cần script, nhưng cần biết trước khi deploy lên DB chung.
- `.env`: đổi `FREE_TIER_MONTHLY_MESSAGES` → `FREE_TIER_WEEKLY_MESSAGES=15`.
- `POST /api/artifacts` (endpoint tạo artifact chung) **từ chối** `type: "SUMMARY"` — nếu không sẽ thành đường vòng lách kiểm tra owner.
- Ràng buộc "1 tài liệu = 1 summary" được đảm bảo bằng unique index trên `summaryDocumentId`, không phải bằng check trong code — nên 2 lần bấm đồng thời không thể trừ 2 lượt quota.
