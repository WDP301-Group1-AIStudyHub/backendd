# AI Study Hub Backend Presentation

Tài liệu này dùng để thuyết trình backend AI Study Hub theo kiến trúc hiện tại: hệ thống RAG tổng quát cho tài liệu học tập, không phụ thuộc vào loại tài liệu cụ thể.

## 1. Tổng quan project

AI Study Hub là hệ thống hỗ trợ học tập bằng AI. Người dùng upload tài liệu PDF, sau đó đặt câu hỏi về nội dung tài liệu. Backend sẽ xử lý PDF, trích xuất nội dung, chia nhỏ tài liệu, tạo embedding, lưu vào vector database và dùng RAG để trả lời dựa trên tài liệu đã upload.

Backend đảm nhận các vai trò chính:

- Xác thực người dùng bằng JWT.
- Nhận và xử lý file PDF.
- Lưu file gốc vào Cloudinary.
- Lưu metadata, extracted text, chat history và evaluation log vào MongoDB.
- Chia tài liệu thành chunks.
- Tạo embedding bằng Jina Embeddings.
- Lưu và tìm kiếm vector bằng Pinecone.
- Sinh câu trả lời bằng Groq dựa trên context retrieve được.
- Kiểm tra grounding để giảm hallucination.

## 2. Tech stack

| Công nghệ | Vai trò |
|---|---|
| Node.js | Runtime chạy backend JavaScript/TypeScript |
| Express | Xây dựng REST API, routes, middleware |
| TypeScript | Tăng type safety, dễ maintain service/model/type |
| MongoDB | Lưu user, document metadata, chat history, benchmark, evaluation log |
| Mongoose | Định nghĩa schema và thao tác MongoDB |
| Cloudinary | Lưu file PDF gốc dạng raw file |
| Multer | Nhận file upload từ frontend |
| pdf-parse | Trích xuất text từ PDF |
| Jina Embeddings | Tạo vector embedding cho chunks và câu hỏi |
| Pinecone | Vector database cho semantic search |
| Groq | LLM sinh câu trả lời cuối cùng |
| JWT | Xác thực protected APIs |
| Zod | Validate request body/params/query |
| Swagger | Tài liệu API tại `/api-docs` |

## 3. Kiến trúc tổng thể

```text
User
↓
React Frontend
↓
Express Backend
↓
MongoDB / Cloudinary
↓
PDF Text Extraction
↓
Chunking + Generic Heading Detection
↓
Jina Embeddings
↓
Pinecone Semantic Search
↓
Relevant Chunks
↓
Groq Answer Generation
↓
Grounding Check
↓
Chat History
```

## 4. Luồng upload tài liệu

1. Frontend gọi `POST /api/documents/upload` với `multipart/form-data`.
2. Backend dùng Multer nhận file PDF vào memory.
3. Backend upload file gốc lên Cloudinary.
4. Backend dùng `pdf-parse` extract text từ PDF.
5. Metadata tài liệu và extracted text được lưu vào MongoDB.
6. Text được chia thành chunks bằng `RecursiveCharacterTextSplitter`.
7. Chunking có generic heading detection để nhận biết các vùng nội dung nếu heading đủ rõ về mặt format.
8. Mỗi chunk được tạo Jina embedding.
9. Vector và metadata chunk được upsert vào Pinecone.

Metadata Pinecone gồm:

- `documentId`
- `userId`
- `subject`
- `title`
- `chunkIndex`
- `section`
- `content`

`section` hiện chỉ là metadata tổng quát, không dùng để hard-code domain. Các giá trị có thể là:

- `CONTENT`
- `INSTRUCTIONS`
- `QUESTIONS`
- `SUMMARY`
- `UNKNOWN`

## 5. Generic heading detection

Trước đây hệ thống từng có hướng detect section bằng keyword cố định. Kiến trúc hiện tại đã bỏ cách đó để tránh phụ thuộc vào một loại tài liệu.

Hiện tại heading detection dựa trên format signals:

- Dòng ngắn.
- Tỷ lệ chữ in hoa cao.
- Không kết thúc bằng dấu câu như `.`, `!`, `?`.
- Dòng đứng tương đối độc lập.
- Dòng phía sau có nội dung.
- Cho phép numbered heading dạng `1.`, `1.1`, `Chapter 1`, `Section 2` như pattern tổng quát.

Nếu không đủ tự tin, hệ thống gán section là `UNKNOWN` hoặc giữ nội dung như `CONTENT`.

Điểm quan trọng: heading detection chỉ hỗ trợ chia tài liệu tốt hơn, retrieval chính vẫn dựa trên semantic similarity từ embedding và Pinecone score.

## 6. Luồng chatbot hỏi đáp

Frontend gọi:

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

Backend xử lý:

1. Detect intent và answer style từ câu hỏi.
2. Tạo embedding cho câu hỏi bằng Jina.
3. Query Pinecone để lấy chunks gần nghĩa nhất.
4. Chọn chunks làm context.
5. Gửi context + question sang Groq.
6. Groq sinh câu trả lời.
7. Backend chạy grounding check.
8. Nếu answer chưa grounded, backend regenerate một lần với strict prompt.
9. Lưu chat history và evaluation log.

## 7. RAG là gì trong project này?

RAG là Retrieval-Augmented Generation. Ý tưởng là trước khi AI trả lời, backend sẽ retrieve các đoạn tài liệu liên quan nhất. Sau đó LLM chỉ trả lời dựa trên các đoạn này.

Trong AI Study Hub:

```text
User Question
↓
Embedding
↓
Pinecone Semantic Search
↓
Relevant Chunks
↓
Groq Answer Generation
↓
Grounding Check
```

RAG giúp:

- Trả lời dựa trên tài liệu user upload.
- Giảm việc AI bịa thông tin.
- Tìm kiếm theo ngữ nghĩa thay vì chỉ keyword.
- Hỗ trợ nhiều loại tài liệu học tập: slide, notes, đề thi, paper, technical docs.

## 8. Corrective RAG

Corrective RAG là luồng nâng cao hơn Basic RAG.

### Query rewriting

Backend rewrite câu hỏi để retrieval tốt hơn nhưng vẫn giữ intent gốc. Với câu hỏi yêu cầu trích xuất entity cụ thể, query được giữ gần với câu hỏi ban đầu.

### Relevance evaluation

Sau khi Pinecone trả chunks, backend tính relevance dựa trên:

- Pinecone similarity score.
- Lexical signal nhẹ.
- Threshold relevance.

Không còn boost theo section hard-code hoặc document type.

### Corrective retrieval

Nếu số chunks liên quan chưa đủ, hệ thống rewrite query lần hai và search lại. Sau đó dedupe chunks và chọn context tốt nhất.

### Grounding/self-check

Sau khi Groq trả lời, backend kiểm tra câu trả lời có được hỗ trợ bởi context không. Nếu không đủ grounded, backend sinh lại answer với prompt nghiêm ngặt hơn.

### Evaluation logging

Backend lưu:

- `retrievedChunksCount`
- `relevantChunksCount`
- `averageRelevanceScore`
- `correctiveAttempted`
- `isGrounded`
- `confidenceScore`
- `responseTimeMs`
- `detectedIntent`
- `retrievedSections`

## 9. Vì sao dùng Pinecone thay vì MongoDB để search nội dung?

MongoDB phù hợp lưu dữ liệu nghiệp vụ như user, document, chat history. Nhưng search nội dung học tập cần semantic search.

Ví dụ user hỏi khác từ nhưng cùng ý với tài liệu. Keyword search có thể fail, còn embedding search vẫn tìm được vì so sánh ý nghĩa qua vector.

Pinecone phù hợp vì:

- Tối ưu lưu và query vector.
- Hỗ trợ similarity search.
- Trả về score để backend chọn context.
- Scale tốt hơn cho RAG.

## 10. Vì sao Cloudinary chỉ lưu file, MongoDB chỉ lưu metadata?

File PDF có thể lớn. Lưu file trực tiếp trong MongoDB làm database nặng. Thiết kế hiện tại tách trách nhiệm:

- Cloudinary lưu file gốc.
- MongoDB lưu metadata, URL, extracted text, owner, file info.

Cách này giúp backend dễ scale, dễ quản lý file và dữ liệu nghiệp vụ.

## 11. Design Decisions

### Vì sao bỏ hard-coded document logic?

AI Study Hub là hệ thống học tập tổng quát. Nếu backend hard-code heading hoặc retrieval theo một loại tài liệu cụ thể, hệ thống sẽ hoạt động kém với slide, đề thi, tài liệu kỹ thuật hoặc research paper.

### Vì sao semantic retrieval scalable hơn?

Semantic retrieval không phụ thuộc vào đúng keyword. Nó dựa trên embedding để so sánh ý nghĩa giữa câu hỏi và chunks. Vì vậy hệ thống linh hoạt hơn khi tài liệu có nhiều format và cách diễn đạt khác nhau.

### Vì sao vẫn giữ generic heading detection?

Heading detection giúp chia tài liệu có cấu trúc tốt hơn, nhưng không quyết định retrieval chính. Nếu heading không rõ, hệ thống vẫn hoạt động nhờ embedding và Pinecone.

### Vì sao cần re-index?

Khi thay đổi chunking hoặc metadata, vector cũ trong Pinecone không tự cập nhật. Endpoint reindex giúp xóa vectors cũ, chunk lại, embed lại và upsert vectors mới.

## 12. Giới hạn hiện tại

- PDF scan ảnh cần OCR, hiện chưa hỗ trợ.
- Nếu PDF extraction kém, RAG cũng bị ảnh hưởng.
- Nếu retrieval lấy sai context, answer có thể chưa chính xác.
- Cần benchmark nhiều hơn để chứng minh Corrective RAG tốt hơn Basic RAG.
- Khi thay đổi chunking/metadata cần gọi `POST /api/documents/:documentId/reindex`.

## 13. Script thuyết trình 3-5 phút

Thưa thầy, AI Study Hub là hệ thống hỗ trợ học tập bằng AI. Người dùng có thể upload tài liệu PDF, sau đó đặt câu hỏi trực tiếp trên tài liệu đó.

Ở backend, tụi em dùng Node.js, Express và TypeScript để xây dựng REST API. Backend nhận file bằng Multer, upload file gốc lên Cloudinary, extract text bằng pdf-parse, rồi lưu metadata và extracted text vào MongoDB.

Phần quan trọng nhất là RAG. Sau khi có text, backend chia tài liệu thành chunks. Mỗi chunk được tạo embedding bằng Jina Embeddings và lưu vào Pinecone. Khi user hỏi, câu hỏi cũng được embedding, rồi Pinecone tìm các chunks gần nghĩa nhất. Backend đưa các chunks đó vào context và gửi sang Groq để sinh câu trả lời.

Hệ thống có Basic RAG và Corrective RAG. Basic RAG retrieve rồi trả lời. Corrective RAG có thêm query rewriting, relevance evaluation, retrieval lần hai nếu cần, grounding check và evaluation logging.

Một điểm thiết kế quan trọng là tụi em đã bỏ logic hard-code theo loại tài liệu. Heading detection hiện không dựa trên danh sách keyword cố định, mà dùng tín hiệu format như dòng ngắn, chữ in hoa, numbered heading và dòng đứng độc lập. Retrieval chính vẫn dựa vào semantic similarity từ embedding và Pinecone score, nên hệ thống phù hợp với nhiều loại tài liệu học tập như slide, notes, đề thi, technical docs và research papers.

MongoDB lưu dữ liệu nghiệp vụ, Cloudinary lưu file PDF gốc, Pinecone lưu vector để semantic search. Cách tách này giúp backend rõ trách nhiệm và dễ mở rộng.

Tóm lại, backend không chỉ là API upload file, mà là pipeline xử lý tài liệu, tạo embedding, semantic retrieval, sinh answer và kiểm tra grounding để chatbot trả lời dựa trên tài liệu upload.

## 14. Diagrams

### Upload flow

```text
Frontend
↓
Backend
↓
Cloudinary + MongoDB
↓
PDF Text Extraction
↓
Chunking + Generic Heading Detection
↓
Jina Embeddings
↓
Pinecone Vector DB
```

### Question answering flow

```text
User Question
↓
Embedding
↓
Pinecone Semantic Search
↓
Relevant Chunks
↓
Groq Answer Generation
↓
Grounding Check
↓
Answer
```

### System overview

```text
React Frontend
↓
Express Backend
↓
MongoDB / Cloudinary
↓
Jina Embeddings
↓
Pinecone
↓
Groq
↓
Chat History / Evaluation Logs
```
