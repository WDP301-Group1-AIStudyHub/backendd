import type { AnswerLanguage } from "../utils/answerStyle";

// Deterministic answer for meta questions ("what can you do?", greetings).
// These questions are about the assistant, not the documents, so retrieval
// would only surface whatever happens to embed closest — never the right
// answer. No LLM call needed either; the capabilities are fixed.
export const buildCapabilityAnswer = (language: AnswerLanguage): string => {
  if (language === "Vietnamese") {
    return [
      "Mình là trợ lý học tập AI, trả lời dựa trên các tài liệu bạn đã tải lên. Mình có thể:",
      "",
      "- **Trả lời câu hỏi** về nội dung trong tài liệu của bạn",
      "- **Tóm tắt** một tài liệu, chương hoặc mục cụ thể",
      "- **So sánh** nội dung giữa nhiều tài liệu",
      "- **Trích xuất** tên, ngày tháng, số liệu, khái niệm từ tài liệu",
      "- **Giải thích** khái niệm xuất hiện trong tài liệu",
      "",
      "Bạn có thể chọn phạm vi trả lời theo từng tài liệu, môn học, hoặc toàn bộ thư viện. Hãy tải tài liệu lên và hỏi về nội dung của chúng nhé!",
    ].join("\n");
  }

  return [
    "I'm an AI study assistant that answers based on the documents you have uploaded. I can:",
    "",
    "- **Answer questions** about the content of your documents",
    "- **Summarize** a document, chapter, or specific section",
    "- **Compare** content across multiple documents",
    "- **Extract** names, dates, figures, and concepts from your documents",
    "- **Explain** concepts that appear in your documents",
    "",
    "You can scope answers to a single document, a subject, or your whole library. Upload your documents and ask away!",
  ].join("\n");
};
