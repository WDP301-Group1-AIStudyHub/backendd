import { Type } from "@google/genai";
import { z } from "zod";
import { Artifact, ArtifactType } from "../models/artifact.model";
import { StudyDocument } from "../models/document.model";
import { ChatSource } from "../types/api.types";
import { EvaluatedChunk } from "../types/rag.types";
import { buildContext, retrieveDrRagContext, toSources } from "./drRag.service";
import { generateGeminiText } from "./gemini.service";
import {
  RetrievedChunk,
  searchRelevantChunks,
  VectorSearchFilters,
} from "./vector.service";

const CONTEXT_CHUNK_LIMIT = 10;
const SINGLE_DOCUMENT_CONTEXT_CHARS = 12000;

const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\r?\n/, "");
    cleaned = cleaned.replace(/\r?\n```$/, "");
  }
  return cleaned.trim();
};

const mindmapNodeSchema: z.ZodType<{
  label: string;
  children?: { label: string; children?: unknown[] }[];
}> = z.object({
  label: z.string().min(1),
  children: z.lazy(() => z.array(mindmapNodeSchema)).optional(),
}) as any;

const CONTENT_SCHEMAS: Record<ArtifactType, z.ZodTypeAny> = {
  FLASHCARD: z.object({
    items: z
      .array(z.object({ front: z.string().min(1), back: z.string().min(1) }))
      .min(1),
  }),
  QUIZ: z.object({
    items: z
      .array(
        z.object({
          question: z.string().min(1),
          options: z.array(z.string().min(1)).min(2),
          correctIndex: z.number().int().min(0),
          explanation: z.string(),
        })
      )
      .min(1),
  }),
  MINDMAP: z.object({ root: mindmapNodeSchema }),
  REPORT: z.object({ markdown: z.string().min(1) }),
  SUMMARY: z.object({ markdown: z.string().min(1) }),
  DATA_TABLE: z.object({
    columns: z.array(z.string().min(1)).min(1),
    rows: z.array(z.array(z.string())).min(1),
  }),
};

const JSON_RULES = [
  "Return ONLY a valid JSON object. Do not include markdown codeblocks or any introductory/concluding text.",
  "CRITICAL: If you write any quotes inside a JSON string value, use single quotes (e.g. 'quoted text') instead of double quotes to avoid breaking the JSON structure. Double quotes must ONLY be used to enclose JSON keys and string boundaries.",
  "Write all generated content in the same language as the CONTEXT (e.g. Vietnamese documents produce Vietnamese output), preserving accents and subject-specific terms.",
  "Base every fact strictly on the CONTEXT. Never invent facts that are not supported by the CONTEXT.",
].join(" ");

const buildSystemPrompt = (type: ArtifactType, instructions?: string): string => {
  const focus = instructions
    ? `Focus specifically on: ${instructions}.`
    : "Cover the most important concepts in the CONTEXT.";

  switch (type) {
    case "FLASHCARD":
      return [
        "You are an expert tutor creating flashcards from study material.",
        "Based on the provided CONTEXT, generate 8-12 flashcard items.",
        focus,
        "Each flashcard has a concise term, concept, or question on the 'front', and the detailed explanation/definition/answer on the 'back'.",
        JSON_RULES,
        'JSON structure: { "items": [ { "front": "Term or question", "back": "Definition or answer" } ] }',
      ].join(" ");
    case "QUIZ":
      return [
        "You are an expert tutor creating a quiz from study material.",
        "Based on the provided CONTEXT, generate 6-10 multiple choice questions.",
        focus,
        "Each question has exactly 4 options, one correct answer, and a brief explanation grounded in the CONTEXT.",
        JSON_RULES,
        'JSON structure: { "items": [ { "question": "...?", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "..." } ] }',
      ].join(" ");
    case "MINDMAP":
      return [
        "You are an expert tutor organizing study material into a mind map.",
        "Based on the provided CONTEXT, build a hierarchical mind map: one central topic, 3-6 main branches, each with 2-5 sub-branches. Maximum depth 4 levels.",
        focus,
        "Keep every label short (at most 8 words).",
        JSON_RULES,
        'JSON structure: { "root": { "label": "Central topic", "children": [ { "label": "Branch", "children": [ { "label": "Sub-branch" } ] } ] } }',
      ].join(" ");
    case "SUMMARY":
      // The Summarize button takes no user input (RULE-02 does not apply), so
      // this prompt is fixed — `instructions` is always absent for SUMMARY.
      return [
        "You are summarizing a study document for the person who uploaded it.",
        "Based on the provided CONTEXT, write a faithful summary in GitHub-flavored markdown: a one-paragraph overview of what the document is about, then a '## Key points' section of 5-8 bullets covering the most important content, then a one-sentence takeaway.",
        "Keep it substantially shorter than the source. Do not restate the document section by section, and do not pad with filler.",
        "Write the summary in the same language as the CONTEXT (e.g. Vietnamese documents produce a Vietnamese summary), preserving accents and subject-specific terms.",
        "Base every statement strictly on the CONTEXT. Never invent facts that are not supported by the CONTEXT.",
        "Return ONLY the markdown summary. Do not wrap it in JSON or code fences, and do not add any introductory or concluding remarks outside the summary itself.",
      ].join(" ");
    case "REPORT":
      // Raw markdown, not JSON: LLMs reliably emit literal newlines inside
      // JSON string values, which JSON.parse rejects.
      return [
        "You are an expert tutor writing a structured study report.",
        "Based on the provided CONTEXT, write a well-organized report in GitHub-flavored markdown: a title heading, an overview, 3-6 sections with '##' headings, bullet points for key facts, and a short conclusion.",
        focus,
        "Write the report in the same language as the CONTEXT (e.g. Vietnamese documents produce a Vietnamese report), preserving accents and subject-specific terms.",
        "Base every fact strictly on the CONTEXT. Never invent facts that are not supported by the CONTEXT.",
        "Return ONLY the markdown report. Do not wrap it in JSON or code fences, and do not add any introductory or concluding remarks outside the report itself.",
      ].join(" ");
    case "DATA_TABLE":
      return [
        "You are an expert tutor extracting structured data from study material.",
        "Based on the provided CONTEXT, build one comparison or summary table with 2-6 columns and 3-12 rows.",
        focus,
        "Every cell is a short string.",
        JSON_RULES,
        'JSON structure: { "columns": ["Column A", "Column B"], "rows": [ ["cell", "cell"] ] }',
      ].join(" ");
  }
};

// Google-format response schemas for native structured output. MINDMAP is
// recursive, which this format cannot express — it gets JSON forcing via
// responseMimeType only. REPORT is raw markdown, no schema.
const RESPONSE_SCHEMAS: Partial<Record<ArtifactType, Record<string, unknown>>> =
  {
    FLASHCARD: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              front: { type: Type.STRING },
              back: { type: Type.STRING },
            },
            required: ["front", "back"],
          },
        },
      },
      required: ["items"],
    },
    QUIZ: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "correctIndex", "explanation"],
          },
        },
      },
      required: ["items"],
    },
    DATA_TABLE: {
      type: Type.OBJECT,
      properties: {
        columns: { type: Type.ARRAY, items: { type: Type.STRING } },
        rows: {
          type: Type.ARRAY,
          items: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
      required: ["columns", "rows"],
    },
  };

const MAX_TOKENS: Record<ArtifactType, number> = {
  FLASHCARD: 2200,
  QUIZ: 2200,
  MINDMAP: 1200,
  REPORT: 2500,
  DATA_TABLE: 1200,
  SUMMARY: 1800,
};

const DEFAULT_RETRIEVAL_QUERY: Record<ArtifactType, string> = {
  FLASHCARD: "key terms, definitions and core concepts",
  QUIZ: "key facts, concepts and details suitable for exam questions",
  MINDMAP: "main topics, subtopics and how concepts relate",
  REPORT: "main topics, key facts and important details",
  DATA_TABLE: "comparable facts, categories, figures and properties",
  SUMMARY: "overall purpose, main points and conclusions of the document",
};

// Raw-markdown types skip JSON forcing and JSON.parse: LLMs reliably emit
// literal newlines inside JSON string values, which JSON.parse rejects.
const MARKDOWN_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  "REPORT",
  "SUMMARY",
]);

const generateAndValidate = async (
  type: ArtifactType,
  systemPrompt: string,
  context: string
): Promise<unknown> => {
  const responseText = await generateGeminiText(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: `CONTEXT:\n${context}` },
    ],
    {
      temperature: 0.4,
      maxTokens: MAX_TOKENS[type],
      responseMimeType: MARKDOWN_TYPES.has(type)
        ? undefined
        : "application/json",
      responseSchema: RESPONSE_SCHEMAS[type],
    }
  );

  // REPORT/SUMMARY are raw markdown (see buildSystemPrompt); the rest is JSON.
  const parsed = MARKDOWN_TYPES.has(type)
    ? { markdown: cleanJson(responseText) }
    : JSON.parse(cleanJson(responseText));
  const content = CONTENT_SCHEMAS[type].parse(parsed);

  // QUIZ: correctIndex must point inside options; zod can't cross-validate.
  if (type === "QUIZ") {
    for (const item of (content as { items: { options: string[]; correctIndex: number }[] }).items) {
      if (item.correctIndex >= item.options.length) {
        throw new Error("correctIndex out of range in generated quiz item");
      }
    }
  }

  return content;
};

type ArtifactContext = { context: string; sources: ChatSource[] };

// Single-document scope: use the document's full extracted text instead of
// vector search. Full coverage is what whole-document artifacts want, and it
// sidesteps query-language mismatch entirely (the cause of spurious
// "no relevant content" failures on Vietnamese documents).
const buildSingleDocumentContext = async (
  documentId: string
): Promise<ArtifactContext | null> => {
  const document = await StudyDocument.findById(documentId);
  const text = document?.extractedText?.trim();
  if (!document || !text) return null;
  return {
    context: text.slice(0, SINGLE_DOCUMENT_CONTEXT_CHARS),
    sources: [
      {
        documentId: document._id.toString(),
        title: document.title,
        chunkIndex: 0,
        contentPreview: text.slice(0, 180),
      },
    ],
  };
};

const toEvaluatedChunks = (chunks: RetrievedChunk[]): EvaluatedChunk[] =>
  chunks.map((chunk) => ({
    ...chunk,
    relevanceScore: chunk.pineconeScore ?? 0,
    isRelevant: true,
  }));

const assembleArtifactContext = async (
  type: ArtifactType,
  vectorFilters: VectorSearchFilters,
  instructions?: string
): Promise<ArtifactContext | null> => {
  // Tier 1: single-document scope reads extractedText directly.
  if (vectorFilters.documentId) {
    const single = await buildSingleDocumentContext(vectorFilters.documentId);
    if (single) return single;
  }

  const query = instructions?.trim() || DEFAULT_RETRIEVAL_QUERY[type];

  // Tier 2: relevance-filtered retrieval.
  const retrieval = await retrieveDrRagContext(query, vectorFilters, {
    contextLimit: CONTEXT_CHUNK_LIMIT,
    skipGroundingGuard: true,
  });
  if (retrieval.chunks.length > 0) {
    return {
      context: buildContext(retrieval.chunks),
      sources: toSources(retrieval.chunks),
    };
  }

  // Tier 3: raw Pinecone matches without relevance filtering — rescues vague
  // or language-mismatched queries where embeddings still rank related
  // content first but below the relevance thresholds.
  const raw = await searchRelevantChunks(query, vectorFilters, CONTEXT_CHUNK_LIMIT);
  if (raw.length > 0) {
    const evaluated = toEvaluatedChunks(raw);
    return {
      context: buildContext(evaluated),
      sources: toSources(evaluated),
    };
  }

  return null;
};

import { resolveCredentialForUser, runWithCredential } from "./aiCredentialContext";

export const runArtifactGenerationWorker = async (
  artifactId: string,
  type: ArtifactType,
  vectorFilters: VectorSearchFilters,
  instructions?: string
): Promise<void> => {
  const artifactDoc = await Artifact.findById(artifactId).select("userId");
  const credential = await resolveCredentialForUser(artifactDoc?.userId?.toString());

  return runWithCredential(credential, async () => {
    try {
      await Artifact.findByIdAndUpdate(artifactId, { status: "GENERATING" });

      const assembled = await assembleArtifactContext(
        type,
        vectorFilters,
        instructions
      );

      // Grounding guard: without any document content the LLM would have to
      // invent everything, so fail instead of generating from model knowledge.
      if (!assembled) {
        throw new Error(
          "No relevant content found in the selected documents for this topic"
        );
      }

      const { context, sources } = assembled;
      const systemPrompt = buildSystemPrompt(type, instructions);

      // Model JSON output can occasionally fail validation, so retry once.
      let content: unknown;
      try {
        content = await generateAndValidate(type, systemPrompt, context);
      } catch (firstError) {
        console.warn(
          `Artifact ${artifactId}: first generation attempt failed, retrying once.`,
          firstError
        );
        content = await generateAndValidate(type, systemPrompt, context);
      }

      await Artifact.findByIdAndUpdate(artifactId, {
        status: "COMPLETED",
        content,
        sources,
      });
    } catch (error: any) {
      const errorMessage =
        error?.message || "Unknown error occurred during artifact generation";
      console.error(`Worker error generating artifact ${artifactId}:`, error);
      await Artifact.findByIdAndUpdate(artifactId, {
        status: "FAILED",
        error: errorMessage,
      });
    }
  });
};
