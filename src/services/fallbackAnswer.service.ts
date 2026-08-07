import { generateGeminiText } from "./gemini.service";
import type { AnswerProfile } from "../utils/answerProfile";
import type { AnswerLanguage } from "../utils/answerStyle";

export type FallbackReason =
  | "document_processing"
  | "document_empty"
  | "no_relevant_chunks_found"
  | "out_of_scope"
  | "retrieved_chunks_not_relevant_enough"
  | "insufficient_document_context"
  | "empty_answer"
  | "grounding_failed";

export type FallbackAnswerParams = {
  question: string;
  language: AnswerLanguage;
  retrievedChunksCount: number;
  relevantChunksCount: number;
  averageRelevanceScore: number;
  documentTitle?: string;
  subject?: string;
  reason?: FallbackReason;
  answerProfile?: AnswerProfile;
};

const getFallbackReason = (params: FallbackAnswerParams): FallbackReason => {
  if (params.reason) {
    return params.reason;
  }

  if (params.retrievedChunksCount === 0) {
    return "no_relevant_chunks_found";
  }

  if (params.relevantChunksCount === 0) {
    return "retrieved_chunks_not_relevant_enough";
  }

  return "insufficient_document_context";
};

const getDeterministicFallback = (
  language: AnswerLanguage,
  reason: FallbackReason,
): string => {
  if (language === "Vietnamese") {
    if (reason === "out_of_scope") {
      return "Câu hỏi này không liên quan đến nội dung của tài liệu đã chọn, nên mình không thể trả lời dựa trên tài liệu. Hãy hỏi về nội dung có trong tài liệu hoặc chọn tài liệu phù hợp hơn.";
    }

    if (reason === "no_relevant_chunks_found") {
      return "Hiện tại mình chưa tìm thấy đoạn nội dung liên quan trong tài liệu đã tải lên để trả lời câu hỏi này. Bạn có thể thử hỏi cụ thể hơn, chọn đúng tài liệu/môn học, hoặc xoá và tải lại tài liệu nếu file chưa được xử lý đúng.";
    }

    if (reason === "retrieved_chunks_not_relevant_enough") {
      return "Mình có tìm thấy một số đoạn trong tài liệu, nhưng chúng chưa đủ liên quan để trả lời chắc chắn. Bạn có thể hỏi cụ thể hơn, chọn đúng tài liệu/môn học, hoặc xoá và tải lại tài liệu nếu file chưa được xử lý đúng.";
    }

    if (reason === "empty_answer" || reason === "grounding_failed") {
      return "Mình đã thử tạo câu trả lời, nhưng câu trả lời đó chưa được tài liệu hỗ trợ đủ rõ. Bạn có thể hỏi cụ thể hơn hoặc xoá và tải lại tài liệu nếu file chưa được xử lý đúng.";
    }

    return "Hiện tại mình chưa tìm thấy thông tin đủ rõ trong tài liệu đã tải lên để trả lời câu hỏi này. Bạn có thể thử hỏi cụ thể hơn, chọn đúng tài liệu/môn học, hoặc xoá và tải lại tài liệu nếu file chưa được xử lý đúng.";
  }

  if (reason === "out_of_scope") {
    return "This question is not related to the selected document, so I cannot answer it from the document. Please ask about the document content or select a more relevant document.";
  }

  if (reason === "no_relevant_chunks_found") {
    return "I could not find any relevant passages in your uploaded documents for this question. Try asking more specifically, selecting the correct document or subject, or deleting and re-uploading the file if it was not processed correctly.";
  }

  if (reason === "retrieved_chunks_not_relevant_enough") {
    return "I found some passages in the document, but they are not relevant enough to answer confidently. Try asking more specifically, selecting the correct document or subject, or deleting and re-uploading the file if it was not processed correctly.";
  }

  if (reason === "empty_answer" || reason === "grounding_failed") {
    return "I tried to generate an answer, but it was not well supported by the uploaded document content. Try asking more specifically, or deleting and re-uploading the file if it was not processed correctly.";
  }

  return "I could not find enough relevant information in the uploaded documents to answer this question. Try asking more specifically, selecting the correct document or subject, or deleting and re-uploading the file if it was not processed correctly.";
};

export const generateFallbackAnswer = async (
  params: FallbackAnswerParams,
): Promise<string> => {
  const reason = getFallbackReason(params);
  const deterministicFallback = getDeterministicFallback(
    params.language,
    reason,
  );

  // The LLM variant only earns its extra latency for detailed answers; every
  // other case (including out_of_scope refusals) uses the canned message. The
  // user question is deliberately never sent to the model here: with no
  // retrieved context to ground on, embedding it invites the model to answer
  // from outside knowledge.
  if (params.answerProfile !== "detailed" || reason === "out_of_scope") {
    return deterministicFallback;
  }

  const isVietnamese = params.language === "Vietnamese";
  const languageInstruction =
    params.language === "other"
      ? "the same language as the user's question"
      : params.language;
  const prompt = `
You are an empathetic educational assistant generating a polite fallback response when source retrieval yields insufficient context.

INPUT METRICS PROVIDED:
- Detected Language: ${languageInstruction}
- Retrieval Result: Insufficient context / No matching passages found.

INSTRUCTIONS:
1. State clearly that the uploaded documents do not currently contain enough information to answer the question accurately.
2. Provide 3 actionable recovery steps:
   - Ask a more targeted question with specific terms.
   - Select or upload the specific document/course subject covering this topic.
   - Check if the source file was fully processed in the Documents panel.
3. Write the entire response in the primary language specified by ${languageInstruction}.

LOCALIZATION GUIDELINES FOR HEADINGS:
- If language is Vietnamese: Use "Vấn đề", "Lý do", "Gợi ý tiếp theo".
- If language is English: Use "Issue", "Reason", "Suggested Next Steps".
- For other languages: Translate these section headers natively.

OUTPUT FORMAT:
Return clean Markdown formatting only.

Document title: ${params.documentTitle || "N/A"}
Subject: ${params.subject || "N/A"}
retrievedChunksCount: ${params.retrievedChunksCount}
relevantChunksCount: ${params.relevantChunksCount}
averageRelevanceScore: ${params.averageRelevanceScore}
reason: ${reason}
`;

  try {
    const fallback = await generateGeminiText(
      [
        {
          role: "user",
          content: prompt,
        },
      ],
      {
        temperature: 0,
        maxTokens: 360,
        // The user already waited through a failed pipeline; a courtesy
        // message is not worth retry backoff on top of that.
        retries: 0,
      },
    );

    return fallback || deterministicFallback;
  } catch (error) {
    console.warn("[RAG fallback] Could not generate fallback answer", {
      reason,
      error: error instanceof Error ? error.message : error,
    });

    return deterministicFallback;
  }
};
