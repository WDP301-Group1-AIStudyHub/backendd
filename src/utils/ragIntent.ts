export type QuestionIntent =
  | "entity_extraction"
  | "summary"
  | "definition"
  | "instruction"
  | "comparison"
  | "list"
  | "qa";

const ENTITY_PATTERNS = [
  /\b(who|where|when|which|what name|email|date|name|names|location|address)\b/i,
  /(^|\s)ai(\s|$)|ở đâu|khi nào|ngày nào|tên|email nào|địa chỉ|nơi nào/i,
];

const SUMMARY_PATTERNS = [
  /\b(summary|summarize|overview)\b/i,
  /\b(tóm tắt|tổng quan)\b/i,
];

const COMPARISON_PATTERNS = [
  /\b(compare|comparison|difference|versus|vs)\b/i,
  /\b(so sánh|khác nhau|giống nhau)\b/i,
];

const DEFINITION_PATTERNS = [
  /\b(what is|what are|define|definition|meaning of)\b/i,
  /(là gì|định nghĩa|nghĩa là gì)/i,
];

const INSTRUCTION_PATTERNS = [
  /\b(how to|steps|instruction|instructions|procedure|guide)\b/i,
  /(làm thế nào|cách|hướng dẫn|các bước|quy trình)/i,
];

const LIST_PATTERNS = [
  /\b(list|enumerate|what are the main|which items)\b/i,
  /(liệt kê|danh sách|những|các)/i,
];

export const detectQuestionIntent = (question: string): QuestionIntent => {
  if (COMPARISON_PATTERNS.some((pattern) => pattern.test(question))) {
    return "comparison";
  }

  if (SUMMARY_PATTERNS.some((pattern) => pattern.test(question))) {
    return "summary";
  }

  if (DEFINITION_PATTERNS.some((pattern) => pattern.test(question))) {
    return "definition";
  }

  if (ENTITY_PATTERNS.some((pattern) => pattern.test(question))) {
    return "entity_extraction";
  }

  if (LIST_PATTERNS.some((pattern) => pattern.test(question))) {
    return "list";
  }

  if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(question))) {
    return "instruction";
  }

  return "qa";
};
