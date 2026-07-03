import { generateGroqText } from "./groq.service";
import type { AnswerProfile } from "../utils/answerProfile";
import type { AnswerLanguage } from "../utils/answerStyle";

export type FallbackReason =
  | "document_processing"
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
Generate a structured fallback response for a RAG document QA system.
Answer strictly in ${languageInstruction}.
The retrieved document context was insufficient, so the user's question must not be answered.
Do not use outside knowledge and do not invent facts about the uploaded document.
Explain briefly why the answer cannot be found based on the retrieval statistics below.
Suggest what the user can try next: ask a more specific question, choose the correct document or subject, or delete and re-upload the file if it was not processed correctly.
${
  isVietnamese
    ? "Mention likely reasons only when relevant: tài liệu chưa chứa thông tin này, câu hỏi quá chung chung, file chưa được xử lý đúng, cần hỏi cụ thể hơn."
    : "Mention likely reasons only when relevant: the document may not contain this information, the question may be too broad, the file may not have been processed correctly."
}
If retrievedChunksCount is 0, say no relevant passages were found.
If retrievedChunksCount is greater than 0 but relevantChunksCount is 0, say passages were found but not relevant enough.
If reason is grounding_failed or empty_answer, say the generated answer was not well supported by the document content.
${
  isVietnamese
    ? 'Use Markdown with short sections titled "Vấn đề", "Lý do", "Cách hỏi lại tốt hơn".'
    : 'Use Markdown with short sections titled "Problem", "Reason", "How to ask better".'
}
Return only the fallback answer.

Document title: ${params.documentTitle || "N/A"}
Subject: ${params.subject || "N/A"}
retrievedChunksCount: ${params.retrievedChunksCount}
relevantChunksCount: ${params.relevantChunksCount}
averageRelevanceScore: ${params.averageRelevanceScore}
reason: ${reason}
`;

  try {
    const fallback = await generateGroqText(
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
