import { generateGroqText } from "./groq.service";

export type FallbackAnswerParams = {
  question: string;
  language: string;
  retrievedChunksCount: number;
  relevantChunksCount: number;
  averageRelevanceScore: number;
  documentTitle?: string;
  subject?: string;
  reason?: string;
};

const getFallbackReason = (params: FallbackAnswerParams): string => {
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

const getDeterministicFallback = (language: string, reason: string): string => {
  const isVietnamese = language.toLowerCase().includes("vietnamese");

  if (isVietnamese) {
    if (reason === "no_relevant_chunks_found") {
      return "Hiện tại mình chưa tìm thấy đoạn nội dung liên quan trong tài liệu đã upload để trả lời câu hỏi này. Bạn có thể thử hỏi cụ thể hơn, chọn đúng tài liệu/môn học, hoặc kiểm tra lại file đã được xử lý và re-index chưa.";
    }

    if (reason === "retrieved_chunks_not_relevant_enough") {
      return "Mình có tìm thấy một số đoạn trong tài liệu, nhưng chúng chưa đủ liên quan để trả lời chắc chắn. Bạn có thể hỏi cụ thể hơn, chọn đúng tài liệu/môn học, hoặc re-index lại file.";
    }

    if (reason === "grounding_failed") {
      return "Mình đã thử tạo câu trả lời, nhưng câu trả lời đó chưa được tài liệu hỗ trợ đủ rõ. Bạn có thể hỏi cụ thể hơn hoặc kiểm tra lại tài liệu đã được xử lý và re-index chưa.";
    }

    return "Hiện tại mình chưa tìm thấy thông tin đủ rõ trong tài liệu đã upload để trả lời câu hỏi này. Bạn có thể thử hỏi cụ thể hơn, chọn đúng tài liệu/môn học, hoặc kiểm tra lại file đã được xử lý và re-index chưa.";
  }

  if (reason === "grounding_failed") {
    return "I tried to generate an answer, but it was not well supported by the uploaded document context. Please try asking more specifically, selecting the correct document, or re-indexing the file.";
  }

  return "I could not find enough relevant information in the uploaded document to answer this question. Please try asking more specifically, selecting the correct document, or re-indexing the file.";
};

export const generateFallbackAnswer = async (
  params: FallbackAnswerParams,
): Promise<string> => {
  const reason = getFallbackReason(params);
  const prompt = `
Generate a short fallback response for a RAG document QA system.
Answer in the same language as the user's question: ${params.language}.
Do not answer the actual question because the retrieved document context is insufficient.
Do not use outside knowledge.
Do not invent facts from the uploaded document.
Explain briefly why the answer cannot be found based on retrieval quality.
Suggest what the user can try next.
Mention likely reasons only when relevant: tài liệu chưa chứa thông tin này, câu hỏi quá chung chung, tài liệu chưa được re-index, file extract text chưa tốt, cần hỏi cụ thể hơn.
If retrievedChunksCount is 0, say no relevant chunks were found.
If retrievedChunksCount is greater than 0 but relevantChunksCount is 0, say retrieved chunks were found but not relevant enough.
If reason is grounding_failed, say the generated answer was not well supported by the document context.
Keep the response short, maximum 3 sentences.
Return only the fallback answer.

Question: ${params.question}
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
        maxTokens: 150,
      },
    );

    return fallback || getDeterministicFallback(params.language, reason);
  } catch (error) {
    console.warn("[RAG fallback] Could not generate fallback answer", {
      reason,
      error: error instanceof Error ? error.message : error,
    });

    return getDeterministicFallback(params.language, reason);
  }
};
