# Giải thích Backend AI Study Hub để thuyết trình

Tài liệu này giải thích backend của project AI Study Hub theo góc nhìn backend developer. Nội dung tập trung vào cách hệ thống nhận tài liệu, xử lý PDF, lưu trữ dữ liệu, tạo embedding, tìm kiếm ngữ nghĩa bằng Pinecone và trả lời câu hỏi bằng RAG.

> Lưu ý quan trọng: trong flow ban đầu có thể ghi "Gemini Answer", nhưng source code hiện tại đã tách ra như sau:
>
> - Gemini dùng để tạo embedding cho tài liệu và câu hỏi.
> - Groq dùng để sinh câu trả lời cuối cùng.
>
> Vì vậy khi thuyết trình nên nói chính xác là: "Gemini Embedding + Pinecone Retrieval + Groq Answer Generation".

## 1. Tổng quan project

### AI Study Hub là gì?

AI Study Hub là một hệ thống hỗ trợ học tập bằng AI. Người dùng có thể upload tài liệu PDF, sau đó đặt câu hỏi về nội dung tài liệu đó. Hệ thống sẽ đọc nội dung tài liệu, tìm các đoạn liên quan và dùng AI để trả lời dựa trên tài liệu đã upload.

Nói đơn giản:

```text
Upload tài liệu học tập -> AI đọc tài liệu -> User hỏi -> AI trả lời dựa trên tài liệu
```

### Hệ thống giải quyết vấn đề gì?

Khi sinh viên có nhiều tài liệu như slide, giáo trình, đề ôn tập hoặc CV mẫu, việc đọc thủ công để tìm thông tin mất thời gian. AI Study Hub giải quyết vấn đề này bằng cách:

- Lưu tài liệu người dùng upload.
- Trích xuất text từ PDF.
- Chia tài liệu thành các đoạn nhỏ.
- Tạo vector embedding để tìm kiếm ngữ nghĩa.
- Cho phép user hỏi đáp trực tiếp trên tài liệu.
- Lưu lịch sử chat và đánh giá chất lượng RAG.

### Backend đảm nhận vai trò gì?

Backend là phần trung tâm xử lý logic nghiệp vụ. Backend chịu trách nhiệm:

- Xác thực người dùng bằng JWT.
- Nhận file PDF từ frontend.
- Upload file gốc lên Cloudinary.
- Extract text từ PDF.
- Lưu metadata tài liệu vào MongoDB.
- Chia text thành chunks.
- Tạo embedding bằng Gemini.
- Lưu vector vào Pinecone.
- Nhận câu hỏi từ chatbot.
- Retrieval các chunks liên quan.
- Gửi context cho Groq để sinh câu trả lời.
- Lưu chat history và evaluation log.
- Cung cấp API cho frontend gọi.

## 2. Techstack và vai trò từng công nghệ

### Node.js

Node.js là runtime để chạy JavaScript/TypeScript phía server. Project dùng Node.js để xây dựng backend API, xử lý request từ frontend và gọi các dịch vụ bên ngoài như MongoDB, Cloudinary, Gemini, Pinecone, Groq.

### Express

Express là framework web cho Node.js. Trong project này Express dùng để:

- Khai báo API routes như `/api/auth`, `/api/documents`, `/api/chat`.
- Gắn middleware như auth, validate, upload.
- Xử lý request/response.
- Tạo health check và Swagger docs.

### TypeScript

TypeScript giúp code backend có kiểu dữ liệu rõ ràng hơn JavaScript thuần. Ví dụ:

- Định nghĩa `DocumentResponse`, `AskQuestionRequest`, `RagEvaluation`.
- Giảm lỗi khi truyền sai kiểu dữ liệu.
- Dễ maintain khi project có nhiều service và model.

### MongoDB và Mongoose

MongoDB là database NoSQL dùng để lưu dữ liệu dạng document. Mongoose là thư viện ODM giúp định nghĩa schema và thao tác MongoDB dễ hơn.

Trong project, MongoDB lưu:

- User account.
- Document metadata.
- Chat history.
- RAG evaluation log.
- Benchmark questions và benchmark results.

MongoDB không lưu vector embedding chính vì vector search không phải thế mạnh của MongoDB trong project này.

### Cloudinary

Cloudinary dùng để lưu file PDF gốc. Khi user upload tài liệu, backend upload file đó lên Cloudinary với `resource_type: "raw"`.

MongoDB chỉ lưu URL và metadata, còn file thật nằm trên Cloudinary.

### Multer

Multer là middleware xử lý upload file trong Express. Project dùng `multer.memoryStorage()` để nhận file vào memory buffer, sau đó:

- Upload buffer lên Cloudinary.
- Extract text từ buffer bằng pdf-parse.

Hiện middleware chỉ cho phép file PDF và giới hạn 10MB.

### pdf-parse

`pdf-parse` dùng để trích xuất text từ file PDF. Backend nhận PDF buffer, đọc nội dung text, sau đó lưu text này vào MongoDB và dùng nó để tạo chunks cho RAG.

### Gemini API

Trong source code hiện tại, Gemini được dùng cho embedding, không còn dùng để sinh answer cuối cùng.

Gemini giúp biến text thành vector số. Vector này biểu diễn ý nghĩa của đoạn text, để hệ thống có thể tìm kiếm theo ngữ nghĩa thay vì chỉ search keyword.

### Gemini Embedding

Gemini Embedding dùng trong 2 giai đoạn:

- Khi upload tài liệu: tạo embedding cho từng chunk tài liệu.
- Khi user hỏi: tạo embedding cho câu hỏi.

Sau đó Pinecone so sánh vector câu hỏi với vector chunks để tìm đoạn liên quan nhất.

### Pinecone

Pinecone là vector database. Project dùng Pinecone để:

- Lưu embedding của từng chunk.
- Search các chunk liên quan nhất với câu hỏi.
- Filter theo `userId`, `documentId`, `subject`.
- Lưu thêm metadata như `documentId`, `chunkIndex`, `section`, `title`.

### Groq

Groq được dùng để sinh câu trả lời cuối cùng. Sau khi backend lấy được context từ Pinecone, backend gửi context + question sang Groq. Groq trả về answer dựa trên context.

Project có retry logic cho Groq khi gặp rate limit hoặc lỗi server.

### JWT

JWT dùng để xác thực người dùng. Khi user login/register thành công, backend trả access token. Các API protected như upload document, ask chatbot, get history đều cần header:

```http
Authorization: Bearer <token>
```

Middleware sẽ verify token và gắn `req.authUser`.

### Zod

Zod dùng để validate request body, params và query. Ví dụ:

- Register phải có email/password.
- Upload document phải có title.
- Ask question phải có question.
- Document ID phải tồn tại trong params.

Nếu request sai format, backend trả lỗi 400.

### Swagger

Swagger dùng để tạo API documentation tại:

```text
/api-docs
```

Giúp frontend hoặc giảng viên xem các endpoint đang có trong backend.

## 3. Luồng hoạt động tổng thể của hệ thống

Flow tổng thể:

```text
User
→ React Frontend
→ Express Backend
→ MongoDB
→ Cloudinary
→ PDF Text Extraction
→ Chunking + Section Detection
→ Gemini Embedding
→ Pinecone Vector DB
→ Chatbot Question
→ Retrieval
→ Groq Answer
→ Chat History
```

Giải thích ngắn:

1. User upload PDF hoặc đặt câu hỏi từ frontend.
2. Frontend gọi API backend.
3. Backend lưu thông tin user, document, chat history vào MongoDB.
4. File PDF gốc được lưu trên Cloudinary.
5. Text trong PDF được extract bằng pdf-parse.
6. Text được chia thành chunks.
7. Mỗi chunk được tạo embedding bằng Gemini.
8. Embedding và metadata được lưu vào Pinecone.
9. Khi user hỏi, câu hỏi cũng được embedding.
10. Pinecone tìm các chunks gần nghĩa nhất.
11. Backend đưa chunks làm context cho Groq.
12. Groq trả lời dựa trên tài liệu.
13. Backend lưu câu hỏi, câu trả lời và sources vào chat history.

## 4. Luồng upload tài liệu

### API upload

Frontend gửi file lên API:

```http
POST /api/documents/upload
```

Request dạng `multipart/form-data`, gồm:

- `file`: file PDF.
- `title`: tiêu đề tài liệu.
- `description`: mô tả.
- `subject`: môn học/chủ đề.

### Backend nhận file bằng gì?

Backend dùng Multer ở `upload.middleware.ts`.

Multer:

- Nhận file từ request.
- Lưu file tạm trong memory.
- Kiểm tra file có phải PDF không.
- Giới hạn dung lượng file 10MB.

### Upload file lên Cloudinary

Sau khi nhận file, backend gọi `uploadPdfToCloudinary`.

Cloudinary lưu file gốc để user có thể download hoặc frontend hiển thị link file.

Backend có logic tạo tên file an toàn:

- Giữ extension `.pdf`.
- Thay khoảng trắng bằng dấu `-`.
- Loại bỏ ký tự nguy hiểm.

### Extract text từ PDF

Backend dùng `extractPdfText(file.buffer)` để lấy text từ file PDF.

Text này rất quan trọng vì RAG không xử lý trực tiếp file PDF, mà xử lý nội dung text đã extract.

### Lưu metadata vào MongoDB

Backend tạo document trong MongoDB với các field như:

- `title`
- `description`
- `subject`
- `fileUrl`
- `filePublicId`
- `originalFileName`
- `storedFileName`
- `fileExtension`
- `mimeType`
- `fileSize`
- `extractedText`
- `uploadedBy`

MongoDB lưu metadata và extracted text, còn file thật nằm ở Cloudinary.

### Chia text thành chunks

Sau khi lưu document, backend gọi `indexDocumentForRag`.

Text được chia thành nhiều đoạn nhỏ bằng `RecursiveCharacterTextSplitter`. Mỗi chunk có:

- `chunkIndex`
- `content`
- `textLength`
- `section`

### Tạo embeddings

Mỗi chunk được gửi sang Gemini Embedding để tạo vector.

Ví dụ:

```text
"Please read the instructions carefully before doing the questions."
→ [0.12, -0.04, 0.88, ...]
```

Vector này biểu diễn ý nghĩa của đoạn text.

### Lưu vector vào Pinecone

Backend upsert vector vào Pinecone với id dạng:

```text
documentId:chunkIndex
```

Metadata lưu kèm:

- `documentId`
- `userId`
- `subject`
- `title`
- `chunkIndex`
- `section`
- `content`

Nhờ vậy khi retrieval, backend biết chunk thuộc tài liệu nào, user nào, section nào.

## 5. Luồng chatbot hỏi đáp tài liệu

### API hỏi đáp

Frontend gửi câu hỏi lên:

```http
POST /api/chat/ask
```

Body gồm:

```json
{
  "question": "REST API là gì?",
  "documentId": "...",
  "subject": "WDP301",
  "mode": "corrective"
}
```

### Backend nhận dữ liệu gì?

Backend nhận:

- `question`: câu hỏi của user.
- `documentId`: nếu muốn hỏi trong một tài liệu cụ thể.
- `subject`: nếu muốn hỏi theo môn/chủ đề.
- `mode`: `basic` hoặc `corrective`.

### Nếu mode là basic

Backend chạy Basic RAG:

1. Embed câu hỏi bằng Gemini.
2. Query Pinecone lấy top chunks liên quan.
3. Chọn context phù hợp.
4. Gửi context + question sang Groq.
5. Groq trả answer.
6. Self-check grounding.
7. Lưu chat history.

Basic RAG đơn giản hơn, ít bước kiểm tra hơn.

### Nếu mode là corrective

Backend chạy Corrective RAG:

1. Rewrite câu hỏi để search tốt hơn.
2. Query Pinecone lần đầu.
3. Đánh giá relevance từng chunk.
4. Nếu chưa đủ chunk liên quan, query lại lần hai.
5. Dedupe chunks.
6. Có section-aware relevance nếu câu hỏi nhắm section cụ thể.
7. Chọn context cuối cùng.
8. Sinh answer bằng Groq.
9. Check grounding.
10. Nếu answer chưa grounded, regenerate strict mode.
11. Lưu chat history và evaluation log.

### Đưa context vào AI

Backend không đưa toàn bộ tài liệu vào Groq. Backend chỉ đưa các chunks đã retrieval.

Ví dụ context:

```text
[1] Document: Lesson 1, section INSTRUCTIONS
Please read the instructions carefully before doing the questions.
```

Sau đó Groq trả lời dựa trên context này.

### Lưu chat history

Backend lưu:

- userId
- question
- rewrittenQuery
- answer
- sources
- documentId
- subject
- mode
- evaluation

Điều này giúp frontend hiển thị lịch sử hỏi đáp.

## 6. Giải thích RAG trong project này

### RAG là gì?

RAG là viết tắt của Retrieval-Augmented Generation.

Nói dễ hiểu: trước khi AI trả lời, hệ thống sẽ đi tìm tài liệu liên quan trước. Sau đó AI chỉ trả lời dựa trên phần tài liệu vừa tìm được.

### Vì sao cần RAG?

Nếu chỉ hỏi AI bình thường, AI có thể trả lời theo kiến thức chung hoặc bịa thông tin. Với RAG, câu trả lời được giới hạn trong tài liệu user upload.

RAG giúp:

- Trả lời sát tài liệu.
- Giảm hallucination.
- Dẫn nguồn bằng chunks.
- Hỏi đáp được trên tài liệu riêng của từng user.

### RAG giúp chatbot trả lời dựa trên tài liệu upload như thế nào?

Trong project này:

1. Tài liệu được chia thành chunks.
2. Chunks được embedding và lưu trong Pinecone.
3. Câu hỏi của user cũng được embedding.
4. Pinecone tìm chunks gần nghĩa nhất.
5. Groq nhận các chunks đó làm context.
6. Groq trả lời dựa trên context, không phải dựa vào trí nhớ chung.

## 7. Giải thích Corrective RAG

Corrective RAG là phiên bản nâng cấp của Basic RAG. Mục tiêu là nếu retrieval lần đầu chưa tốt, hệ thống có cơ chế sửa lại trước khi sinh answer.

### Query rewriting

Backend rewrite câu hỏi để query Pinecone tốt hơn.

Ví dụ user hỏi:

```text
cái này dùng để làm gì?
```

Hệ thống có thể rewrite thành câu rõ hơn để tìm context trong tài liệu.

Tuy nhiên với câu hỏi trích xuất entity như "công ty nào", hệ thống giữ sát câu hỏi gốc để không làm mất intent của user.

### Relevance evaluation

Sau khi lấy chunks từ Pinecone, backend đánh giá chunk đó có liên quan không.

Evaluation dùng:

- Pinecone similarity score.
- Lexical overlap đơn giản.
- Section-aware boost nếu câu hỏi nhắm section như `WORK_EXPERIENCE`, `EDUCATION`, `SKILLS`.

### Corrective retrieval

Nếu số chunk liên quan chưa đủ, hệ thống rewrite query lần hai và search lại.

Sau đó backend gộp kết quả hai lần search, loại trùng chunk và chọn context tốt nhất.

### Section-aware retrieval

Project có logic phát hiện section trong tài liệu.

Ví dụ câu hỏi:

```text
kinh nghiệm làm việc ở công ty nào?
```

Backend detect target section là `WORK_EXPERIENCE`. Khi retrieval, chunk thuộc `WORK_EXPERIENCE` được ưu tiên, chunk `EDUCATION` bị giảm ưu tiên.

Điều này giúp tránh lỗi lấy nhầm trường học trong section Education thành nơi làm việc.

### Answer self-checking

Sau khi Groq sinh answer, backend gọi grounding check.

Grounding check kiểm tra:

- Answer có dựa trên context không?
- Confidence score bao nhiêu?
- Có warning không?

Nếu answer không grounded, backend regenerate một lần với strict prompt.

### Evaluation logging

Mỗi lần hỏi, backend lưu evaluation log:

- retrievedChunksCount
- relevantChunksCount
- averageRelevanceScore
- correctiveAttempted
- isGrounded
- confidenceScore
- responseTimeMs
- detectedIntent
- detectedTargetSection
- retrievedSections

Dữ liệu này giúp nhóm đánh giá chất lượng RAG về sau.

## 8. Vì sao dùng Pinecone thay vì MongoDB để search nội dung?

MongoDB phù hợp để lưu dữ liệu nghiệp vụ như user, document metadata, chat history. MongoDB có text search, nhưng text search chủ yếu dựa trên keyword.

Trong khi đó, câu hỏi của user có thể khác từ với tài liệu nhưng cùng ý nghĩa.

Ví dụ:

```text
Question: "What should I do before answering?"
Document: "Please read the instructions carefully before doing the questions."
```

Keyword có thể không trùng nhiều, nhưng ý nghĩa vẫn liên quan.

Pinecone giải quyết bằng vector search:

- Tìm theo ngữ nghĩa.
- So sánh embedding của question và chunks.
- Trả về các đoạn gần nghĩa nhất.
- Tối ưu cho dữ liệu vector lớn.

Vì vậy:

- MongoDB lưu dữ liệu hệ thống.
- Pinecone lưu vector để semantic search.

## 9. Vì sao Cloudinary chỉ lưu file, còn MongoDB chỉ lưu metadata?

File PDF có thể lớn. Nếu lưu trực tiếp file trong MongoDB, database sẽ nặng và khó scale.

Thiết kế hiện tại tách rõ:

### Cloudinary

Cloudinary lưu file gốc:

- PDF upload.
- Public URL.
- File raw resource.

### MongoDB

MongoDB lưu metadata:

- File URL.
- Public ID Cloudinary.
- Tên file.
- MIME type.
- Kích thước.
- Extracted text.
- User sở hữu.

Cách này có lợi:

- Database nhẹ hơn.
- File storage chuyên dụng hơn.
- Dễ download file.
- Dễ xóa file khi xóa document.

## 10. Lỗi và giới hạn hiện tại

### Cần re-index nếu thay đổi chunking hoặc metadata

Nếu thay đổi logic chunking hoặc thêm metadata mới như `section`, các vector cũ trong Pinecone vẫn giữ metadata cũ.

Vì vậy cần gọi endpoint:

```http
POST /api/documents/:documentId/reindex
```

Endpoint này:

- Xóa vector cũ.
- Chunk lại document.
- Detect section lại.
- Tạo embedding lại.
- Upsert vector mới vào Pinecone.

### AI vẫn có thể trả lời sai nếu retrieval chưa tốt

Nếu Pinecone retrieve nhầm chunk, hoặc text extract từ PDF không tốt, Groq có thể trả lời chưa đúng.

Project đã có các cơ chế giảm lỗi:

- Corrective RAG.
- Relevance evaluation.
- Section-aware retrieval.
- Grounding check.
- Strict regeneration.

Nhưng vẫn cần kiểm thử thêm với nhiều tài liệu.

### PDF extraction phụ thuộc chất lượng file

Nếu PDF là scan ảnh, `pdf-parse` có thể không extract được text tốt. Khi đó hệ thống cần OCR, nhưng hiện tại backend chưa có OCR.

### Gemini quota và Groq quota

Gemini dùng embedding, Groq dùng answer generation. Nếu API quota hết hoặc rate limit, hệ thống có thể lỗi. Project đã có retry cho Groq, nhưng vẫn phụ thuộc quota provider.

### Cần benchmark để chứng minh Corrective RAG tốt hơn Basic RAG

Project đã có benchmark module để so sánh:

- Basic answer.
- Corrective answer.
- Correctness.
- Faithfulness.
- Relevance.
- Completeness.

Tuy nhiên cần nhiều bộ câu hỏi benchmark thực tế để chứng minh Corrective RAG tốt hơn Basic RAG.

## 11. Script thuyết trình ngắn 3-5 phút

Thưa thầy, project của nhóm em là AI Study Hub, một hệ thống hỗ trợ học tập bằng AI. Ý tưởng chính là sinh viên có thể upload tài liệu PDF lên hệ thống, sau đó đặt câu hỏi trực tiếp trên nội dung tài liệu đó.

Về phía backend, tụi em dùng Node.js, Express và TypeScript để xây dựng REST API. Backend chịu trách nhiệm xác thực user bằng JWT, nhận file upload từ frontend, lưu file PDF lên Cloudinary, extract text từ PDF, lưu metadata vào MongoDB, sau đó xử lý tài liệu để phục vụ chatbot.

Khi user upload PDF, backend nhận file bằng Multer. File gốc được upload lên Cloudinary để lưu trữ. Sau đó backend dùng pdf-parse để trích xuất text từ file PDF. Text này được lưu vào MongoDB cùng với metadata của document, ví dụ như tên file, URL, subject và user đã upload.

Điểm quan trọng của hệ thống là phần RAG. RAG nghĩa là trước khi AI trả lời, hệ thống sẽ đi tìm những đoạn tài liệu liên quan trước. Backend chia text thành các đoạn nhỏ gọi là chunks. Mỗi chunk được tạo embedding bằng Gemini Embedding, rồi lưu vào Pinecone. Pinecone là vector database, giúp tìm kiếm theo ngữ nghĩa thay vì chỉ tìm theo từ khóa.

Khi user hỏi chatbot, backend cũng tạo embedding cho câu hỏi, sau đó query Pinecone để lấy các chunks liên quan nhất. Các chunks này được đưa vào context, rồi gửi sang Groq để sinh câu trả lời. Như vậy AI không trả lời theo kiến thức chung, mà trả lời dựa trên tài liệu user đã upload.

Project có hai chế độ hỏi đáp là Basic RAG và Corrective RAG. Basic RAG là luồng đơn giản: hỏi, tìm chunk, sinh answer. Corrective RAG thì có thêm các bước nâng cao như rewrite câu hỏi, đánh giá độ liên quan của chunks, retrieval lần hai nếu cần, kiểm tra answer có grounded trong tài liệu không, và lưu evaluation log.

Một điểm tụi em có cải thiện là section-aware retrieval. Khi tài liệu có các heading như Work Experience, Education, Skills, backend sẽ detect section và lưu section vào metadata của chunk trong Pinecone. Ví dụ nếu user hỏi kinh nghiệm làm việc ở công ty nào, hệ thống sẽ ưu tiên section Work Experience và tránh lấy nhầm thông tin từ Education.

MongoDB trong project dùng để lưu dữ liệu nghiệp vụ như user, document metadata, chat history và evaluation log. Cloudinary chỉ lưu file PDF gốc. Pinecone dùng riêng cho vector search vì MongoDB không tối ưu cho semantic search.

Hiện tại hệ thống vẫn có một số giới hạn. Nếu thay đổi logic chunking hoặc metadata, tài liệu cũ cần được re-index để vector trong Pinecone được cập nhật. Ngoài ra, chất lượng trả lời vẫn phụ thuộc vào chất lượng PDF extraction, retrieval và prompt. Vì vậy nhóm em có thêm benchmark để so sánh Basic RAG và Corrective RAG, giúp đánh giá hệ thống khách quan hơn.

Tóm lại, backend của AI Study Hub không chỉ là API upload file, mà còn là pipeline xử lý tài liệu, tạo embedding, tìm kiếm ngữ nghĩa và sinh câu trả lời dựa trên tài liệu bằng RAG.

## 12. Diagram dạng text

```text
Frontend
   ↓
Backend
   ↓
MongoDB / Cloudinary
   ↓
PDF Text Extraction
   ↓
Chunking + Section Detection
   ↓
Gemini Embedding
   ↓
Pinecone
   ↓
Retrieval
   ↓
Groq
   ↓
Answer
   ↓
Chat History
```

Flow ngắn gọn:

```text
User
↓
React Frontend
↓
Express Backend
↓
MongoDB / Cloudinary
↓
Embedding
↓
Pinecone
↓
Groq
↓
Answer
```

Nếu muốn trình bày đúng theo flow ban đầu của đề tài, có thể nói:

```text
Frontend
↓
Backend
↓
MongoDB / Cloudinary
↓
Gemini Embedding
↓
Pinecone Retrieval
↓
Groq Answer Generation
↓
Chat History
```

## Các API chính trong backend

### Auth

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
PUT  /api/auth/profile
```

### Documents

```text
POST   /api/documents/upload
GET    /api/documents
GET    /api/documents/search
GET    /api/documents/:id
PUT    /api/documents/:id
DELETE /api/documents/:id
POST   /api/documents/:documentId/reindex
```

### Chatbot

```text
POST   /api/chat/ask
GET    /api/chat/history
GET    /api/chat/history/:id
DELETE /api/chat/history/:id
```

### Evaluation

```text
GET /api/evaluation/logs
GET /api/evaluation/summary
```

### Benchmark

```text
POST   /api/benchmark/questions
GET    /api/benchmark/questions
GET    /api/benchmark/questions/:id
PUT    /api/benchmark/questions/:id
DELETE /api/benchmark/questions/:id
POST   /api/benchmark/questions/:id/run
GET    /api/benchmark/summary
```
