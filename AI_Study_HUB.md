# Đề tài dự kiến: AI Study Hub

## 1. Tên đề tài dự kiến

**AI Study Hub - Hệ thống hỏi đáp tài liệu học tập ứng dụng RAG và AI**

---

## 2. Lĩnh vực ứng dụng

* Giáo dục và đào tạo
* Hỗ trợ tự học
* Quản lý và khai thác tài liệu học tập
* Hệ thống hỏi đáp thông minh dựa trên nội dung tài liệu

---

## 3. Vấn đề thực tế

Hiện nay, sinh viên thường học với nhiều loại tài liệu khác nhau như PDF, slide bài giảng, file Word, Excel, ghi chú và tài liệu Markdown. Khi cần ôn tập hoặc tìm kiếm thông tin, người học phải mất nhiều thời gian để đọc lại toàn bộ tài liệu, tìm đúng chương, đúng mục và tổng hợp nội dung cần thiết.

Ngoài ra, các chatbot AI thông thường thường trả lời dựa trên kiến thức tổng quát trên Internet, nhưng không đảm bảo bám sát nội dung tài liệu mà sinh viên đã upload. Điều này dễ dẫn đến tình trạng trả lời sai ngữ cảnh, thiếu căn cứ hoặc không phù hợp với nội dung môn học do giảng viên cung cấp.

---

## 4. Đối tượng người dùng

* Sinh viên cần hỏi đáp và ôn tập dựa trên tài liệu môn học đã upload
* Giảng viên muốn cung cấp công cụ hỗ trợ sinh viên khai thác tài liệu học tập
* Nhóm học tập cần quản lý tài liệu và đặt câu hỏi theo từng môn học
* Người tự học cần tóm tắt, tra cứu và giải thích nội dung trong tài liệu

---

## 5. Lý do cần tích hợp AI

Việc tích hợp AI giúp hệ thống không chỉ dừng lại ở chức năng lưu trữ tài liệu mà còn có khả năng hiểu và truy vấn nội dung bên trong tài liệu. AI đóng vai trò quan trọng vì:

* Tự động trích xuất và chuẩn hóa nội dung từ nhiều định dạng file khác nhau
* Chia nhỏ tài liệu theo heading/section để giữ ngữ cảnh tốt hơn
* Tạo embedding để tìm kiếm theo ngữ nghĩa thay vì chỉ tìm theo từ khóa
* Trả lời câu hỏi dựa trên các đoạn tài liệu liên quan đã được truy xuất
* Hỗ trợ tiếng Việt và giữ nguyên ngữ cảnh học thuật của tài liệu
* Giảm tình trạng chatbot trả lời ngoài tài liệu thông qua cơ chế grounding và fallback an toàn

---

## 6. Model AI dự kiến sử dụng

Hệ thống dự kiến sử dụng kết hợp nhiều model và dịch vụ AI:

* **Jina Embeddings**: dùng để tạo vector embedding cho câu hỏi và các chunk tài liệu nhằm phục vụ semantic search trên Pinecone.

* **Groq LLM**: dùng để sinh câu trả lời dựa trên context được truy xuất, hỗ trợ rewrite câu hỏi, phân loại intent, kiểm tra grounding và tạo fallback answer khi context không đủ.

* **Pinecone Vector Database**: dùng để lưu trữ và truy vấn vector embedding của tài liệu.

### Kiến trúc xử lý chính

```text
Upload tài liệu
→ Trích xuất text
→ Chia chunk theo heading/section
→ Tạo embedding bằng Jina
→ Lưu vector vào Pinecone
→ Người dùng đặt câu hỏi
→ Truy xuất các chunk liên quan
→ Groq sinh câu trả lời dựa trên context
→ Kiểm tra grounding và trả fallback nếu context không đủ
```

---

## 7. Kết quả mong muốn

Hệ thống hướng tới các kết quả sau:

* Cho phép upload nhiều định dạng tài liệu học tập như PDF, DOCX, PPTX, XLSX, TXT và Markdown
* Trích xuất nội dung tài liệu thành plain text để phục vụ pipeline RAG
* Chia tài liệu theo heading, title và section nhằm giữ ngữ cảnh tốt hơn khi hỏi đáp
* Hỗ trợ người dùng đặt câu hỏi bằng tiếng Việt và nhận câu trả lời bám sát tài liệu đã upload
* Giảm hallucination bằng cách chỉ trả lời dựa trên context được truy xuất từ tài liệu
* Khi context không đủ, hệ thống sẽ tạo fallback answer hữu ích để giải thích lý do không thể trả lời và gợi ý người dùng đặt câu hỏi cụ thể hơn hoặc kiểm tra lại tài liệu
* Cung cấp chức năng benchmark để so sánh hiệu quả giữa Basic RAG và Corrective RAG
* Hỗ trợ đánh giá chất lượng hệ thống thông qua các tiêu chí như relevance, faithfulness và correctness
* Cải thiện trải nghiệm học tập, giúp sinh viên tiết kiệm thời gian tra cứu, ôn tập và nắm bắt nội dung tài liệu hiệu quả hơn
