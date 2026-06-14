import { getFileExtension } from "../../utils/fileName";
import { extractDocxDocument } from "./docxExtractor";
import { extractPdfDocument } from "./pdfExtractor";
import { extractPptxDocument } from "./pptxExtractor";
import { extractTextDocument } from "./textExtractor";
import { ExtractedDocument } from "./types";
import { extractXlsxDocument } from "./xlsxExtractor";
import { repairUtf8Mojibake } from "../../utils/textEncoding";

export const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
]);

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".txt",
  ".md",
]);

type ExtractorName = "pdf" | "docx" | "pptx" | "xlsx" | "text";

const mimeTypeToExtractor: Record<string, ExtractorName> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "text",
  "text/markdown": "text",
};

const extensionToExtractor: Record<string, ExtractorName> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".txt": "text",
  ".md": "text",
};

const resolveExtractor = (
  mimeType: string | undefined,
  fileName: string,
): ExtractorName | undefined =>
  (mimeType ? mimeTypeToExtractor[mimeType] : undefined) ||
  extensionToExtractor[getFileExtension(fileName)];

export const isSupportedDocument = (
  mimeType: string | undefined,
  fileName: string,
): boolean => Boolean(resolveExtractor(mimeType, fileName));

export const getSupportedDocumentTypesLabel = (): string =>
  "PDF, DOCX, PPTX, XLSX, TXT, and MD";

export const extractDocumentText = async (
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): Promise<ExtractedDocument> => {
  const startedAt = Date.now();
  const extractorName = resolveExtractor(mimeType, fileName);

  if (!extractorName) {
    throw new Error(`Unsupported document type: ${mimeType || fileName}`);
  }

  console.log("[Document extraction] Started", {
    fileName,
    mimeType,
    parser: extractorName,
  });

  try {
    let extractedDocument: ExtractedDocument;

    switch (extractorName) {
      case "pdf":
        extractedDocument = await extractPdfDocument(buffer);
        break;
      case "docx":
        extractedDocument = await extractDocxDocument(buffer);
        break;
      case "pptx":
        extractedDocument = await extractPptxDocument(buffer);
        break;
      case "xlsx":
        extractedDocument = await extractXlsxDocument(buffer);
        break;
      case "text":
        extractedDocument = await extractTextDocument(buffer);
        break;
    }

    const encodingRepair = repairUtf8Mojibake(extractedDocument.extractedText);
    const normalizedText = encodingRepair.text.trim();
    const durationMs = Date.now() - startedAt;

    // Embedding models operate on natural-language text, not raw Office/PDF
    // binaries. Every parser normalizes its format into plain text so the
    // existing chunking, embedding, and Pinecone indexing flow stays unchanged.
    console.log("[Document extraction] Completed", {
      fileName,
      parser: extractorName,
      extractedTextLength: normalizedText.length,
      encodingRepaired: encodingRepair.repaired,
      durationMs,
    });

    return {
      ...extractedDocument,
      extractedText: normalizedText,
      metadata: {
        ...extractedDocument.metadata,
        parser: extractedDocument.metadata?.parser || extractorName,
        fileName,
        mimeType,
        fileExtension: getFileExtension(fileName),
        encodingRepaired: encodingRepair.repaired,
        mojibakeScoreBefore: encodingRepair.mojibakeScoreBefore,
        mojibakeScoreAfter: encodingRepair.mojibakeScoreAfter,
        durationMs,
      },
    };
  } catch (error) {
    console.error("[Document extraction] Failed", {
      fileName,
      mimeType,
      parser: extractorName,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
};
