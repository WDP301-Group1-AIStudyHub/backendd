import { StudyMaterial } from "../models/studyMaterial.model";
import { StudyDocument } from "../models/document.model";
import { generateGroqText } from "./groq.service";
import { emitUploadProgress } from "./uploadProgress.socket";

const cleanJson = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\r?\n/, "");
    cleaned = cleaned.replace(/\r?\n```$/, "");
  }
  return cleaned.trim();
};

export const runMaterialGenerationWorker = async (
  materialId: string,
  userId: string,
  documentId: string,
  type: "MCQ" | "FLASHCARD",
  count: number,
  difficulty?: string,
  topicFocus?: string
): Promise<void> => {
  try {
    // 1. Update status to GENERATING
    await StudyMaterial.findByIdAndUpdate(materialId, { status: "GENERATING" });

    // 2. Fetch the document text
    const document = await StudyDocument.findById(documentId);
    if (!document || !document.extractedText || document.extractedText.trim().length === 0) {
      throw new Error("Source document text context is empty or unavailable");
    }

    // Slice context to fit LLM window limit (roughly 12000 chars to be safe)
    const context = document.extractedText.slice(0, 12000);

    // 3. Define prompts
    let systemPrompt = "";
    if (type === "MCQ") {
      systemPrompt = [
        "You are an expert tutor creating study aids for students.",
        "Based on the provided CONTEXT, generate exactly",
        count,
        "Multiple Choice Questions (MCQs) in Vietnamese.",
        difficulty ? `Ensure the difficulty level of the questions is ${difficulty}.` : "",
        topicFocus ? `Focus specifically on the following topic focus/guidelines: ${topicFocus}.` : "",
        "Ensure all questions, options, and explanations are in Vietnamese.",
        "Preserve Vietnamese accents and subject-specific terms.",
        "Also extract 3-5 high-level 'topicsCovered' by this quiz, and suggest 3-5 'followUpTopics' for further study.",
        "Return ONLY a valid JSON object. Do not include markdown codeblocks or any introductory/concluding text.",
        "CRITICAL: If you write any quotes inside a JSON string value, use single quotes (e.g. 'quoted text') instead of double quotes to avoid breaking the JSON structure. Double quotes must ONLY be used to enclose JSON keys and string boundaries.",
        "JSON structure:",
        "{",
        '  "topicsCovered": ["Topic A", "Topic B"],',
        '  "followUpTopics": ["Follow-up X", "Follow-up Y"],',
        '  "items": [',
        "    {",
        '      "question": "Clear and specific question based on facts in context?",',
        '      "options": ["Option A", "Option B", "Option C", "Option D"],',
        '      "correctIndex": 0, // 0-based index of correct option',
        '      "explanation": "Brief explanation of why this answer is correct based on the text"',
        "    }",
        "  ]",
        "}"
      ].filter(Boolean).join(" ");
    } else {
      systemPrompt = [
        "You are an expert tutor creating study aids for students.",
        "Based on the provided CONTEXT, generate exactly",
        count,
        "Flashcard items in Vietnamese.",
        difficulty ? `Ensure the difficulty level of the flashcards is ${difficulty}.` : "",
        topicFocus ? `Focus specifically on the following topic focus/guidelines: ${topicFocus}.` : "",
        "Each flashcard must have a concise term, concept, or question on the 'front', and the detailed explanation/definition/answer on the 'back'.",
        "Ensure all content is in Vietnamese, preserving accents and educational terms.",
        "Also extract 3-5 high-level 'topicsCovered' by these flashcards, and suggest 3-5 'followUpTopics' for further study.",
        "Return ONLY a valid JSON object. Do not include markdown codeblocks or any introductory/concluding text.",
        "CRITICAL: If you write any quotes inside a JSON string value, use single quotes (e.g. 'quoted text') instead of double quotes to avoid breaking the JSON structure. Double quotes must ONLY be used to enclose JSON keys and string boundaries.",
        "JSON structure:",
        "{",
        '  "topicsCovered": ["Topic A", "Topic B"],',
        '  "followUpTopics": ["Follow-up X", "Follow-up Y"],',
        '  "items": [',
        "    {",
        '      "front": "Term, concept or question",',
        '      "back": "Detailed definition, explanation or answer"',
        "    }",
        "  ]",
        "}"
      ].filter(Boolean).join(" ");
    }

    // 4. Call Groq
    const responseText = await generateGroqText(
      [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `CONTEXT:\n${context}`,
        },
      ],
      {
        temperature: 0.5,
        maxTokens: type === "MCQ" ? 2200 : 1600,
      }
    );

    const cleanedText = cleanJson(responseText);

    let items: any[] = [];
    let topicsCovered: string[] = [];
    let followUpTopics: string[] = [];

    try {
      const parsed = JSON.parse(cleanedText);
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === "object") {
        items = parsed.items || [];
        topicsCovered = parsed.topicsCovered || [];
        followUpTopics = parsed.followUpTopics || [];
      }
    } catch (e) {
      console.error("Failed to parse JSON response from Groq:", cleanedText);
      throw new Error("Generated response format was invalid. Please try again.");
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("Generated response was not a populated array");
    }

    // 5. Save results to database
    const finalMaterial = await StudyMaterial.findByIdAndUpdate(
      materialId,
      {
        title: `${type === "MCQ" ? "Quiz" : "Flashcards"} - ${document.title}`,
        status: "COMPLETED",
        items,
        topicsCovered,
        followUpTopics,
      },
      { new: true }
    );

    // 6. Broadcast completion event via Socket.IO
    emitUploadProgress("study-material:update", {
      documentId,
      status: "completed" as any,
      step: "generation",
      progress: 100,
      message: `${type === "MCQ" ? "Quiz" : "Flashcards"} generated successfully!`,
      materialId,
      title: finalMaterial?.title,
    } as any);

  } catch (error: any) {
    const errorMessage = error.message || "Unknown error occurred during generation";
    console.error("Worker error generating study material:", error);

    // Mark as failed in DB
    await StudyMaterial.findByIdAndUpdate(materialId, {
      status: "FAILED",
      error: errorMessage,
    });

    // Broadcast failure event
    emitUploadProgress("study-material:update", {
      documentId,
      status: "failed" as any,
      step: "generation",
      progress: 0,
      message: `Failed to generate: ${errorMessage}`,
    } as any);
  }
};
