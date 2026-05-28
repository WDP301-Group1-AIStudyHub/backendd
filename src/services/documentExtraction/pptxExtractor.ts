import { ExtractedDocument } from "./types";

const PPTX2Json = require("pptx2json");

const slidePathPattern = /^ppt\/slides\/slide(\d+)\.xml$/;

const collectSlideText = (value: unknown, textParts: string[]): void => {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectSlideText(item, textParts));
    return;
  }

  const record = value as Record<string, unknown>;
  const textNode = record["a:t"];

  if (Array.isArray(textNode)) {
    textNode.forEach((item) => {
      if (typeof item === "string" && item.trim()) {
        textParts.push(item.trim());
      }
    });
  }

  Object.entries(record).forEach(([key, childValue]) => {
    if (key !== "a:t") {
      collectSlideText(childValue, textParts);
    }
  });
};

export const extractPptxDocument = async (
  buffer: Buffer,
): Promise<ExtractedDocument> => {
  const parser = new PPTX2Json();
  const parsedPresentation = await parser.buffer2json(buffer);
  const slideEntries = Object.entries(parsedPresentation)
    .map(([path, value]) => {
      const match = path.match(slidePathPattern);
      return match ? { slideNumber: Number(match[1]), value } : null;
    })
    .filter(
      (entry): entry is { slideNumber: number; value: unknown } =>
        entry !== null,
    )
    .sort((a, b) => a.slideNumber - b.slideNumber);

  const slideTexts = slideEntries
    .map(({ slideNumber, value }) => {
      const textParts: string[] = [];
      collectSlideText(value, textParts);

      return textParts.length
        ? `Slide ${slideNumber}\n${textParts.join("\n")}`
        : "";
    })
    .filter(Boolean);

  return {
    extractedText: slideTexts.join("\n\n"),
    pageCount: slideEntries.length,
    metadata: {
      parser: "pptx2json",
      slideCount: slideEntries.length,
    },
  };
};
