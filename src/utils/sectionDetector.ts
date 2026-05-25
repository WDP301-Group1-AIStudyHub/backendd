export type DocumentSection =
  | "INSTRUCTIONS"
  | "QUESTIONS"
  | "SUMMARY"
  | "CONTENT"
  | "UNKNOWN";

export const normalizeSectionText = (text: string): string =>
  text
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;.,|/\\-]+|[\s:;.,|/\\-]+$/g, "")
    .trim();
