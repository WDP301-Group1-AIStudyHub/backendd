import { StudyMaterial, IStudyMaterial, MaterialType } from "../models/studyMaterial.model";
import { StudyDocument } from "../models/document.model";
import { AppError } from "../middlewares/error.middleware";
import { runMaterialGenerationWorker } from "./studyMaterial.worker";
import { generateGroqText } from "./groq.service";

export const getStudyMaterialsByDoc = async (
  userId: string,
  documentId: string
): Promise<IStudyMaterial[]> => {
  // Check if document exists and belongs to user
  const documentExists = await StudyDocument.exists({ _id: documentId, ownerId: userId });
  if (!documentExists) {
    throw new AppError("Document not found or access denied", 404);
  }

  return StudyMaterial.find({ documentId, userId }).sort({ createdAt: -1 });
};

export const getStudyMaterialById = async (
  userId: string,
  id: string
): Promise<IStudyMaterial> => {
  const material = await StudyMaterial.findOne({ _id: id, userId });
  if (!material) {
    throw new AppError("Study material not found", 404);
  }
  return material;
};

export const deleteStudyMaterial = async (
  userId: string,
  id: string
): Promise<void> => {
  const result = await StudyMaterial.findOneAndDelete({ _id: id, userId });
  if (!result) {
    throw new AppError("Study material not found or access denied", 404);
  }
};

export const getAllStudyMaterials = async (
  userId: string
): Promise<IStudyMaterial[]> => {
  return StudyMaterial.find({ userId }).sort({ createdAt: -1 });
};

export const initiateMaterialGeneration = async (
  userId: string,
  documentId: string,
  type: MaterialType,
  count: number = 5,
  difficulty?: string,
  topicFocus?: string
): Promise<IStudyMaterial> => {
  // 1. Verify document exists and belongs to user
  const document = await StudyDocument.findOne({ _id: documentId, ownerId: userId });
  if (!document) {
    throw new AppError("Document not found or access denied", 404);
  }

  if (!document.extractedText || document.extractedText.trim().length === 0) {
    throw new AppError("Document text context is empty or has not been extracted yet", 400);
  }

  // 2. Create the placeholder StudyMaterial with PENDING status
  const title = `Generating ${type === "MCQ" ? "Quiz" : "Flashcards"} - ${document.title}`;
  const material = await StudyMaterial.create({
    title,
    userId,
    documentId,
    type,
    status: "PENDING",
    items: [],
  });

  // 3. Trigger worker asynchronously (do not await it)
  runMaterialGenerationWorker(
    material._id.toString(),
    userId,
    documentId,
    type,
    count,
    difficulty,
    topicFocus
  ).catch((err) => {
    console.error(`Uncaught error in material generation worker for ID ${material._id}:`, err);
  });

  return material;
};

export const generateCardExplanation = async (
  userId: string,
  materialId: string,
  cardIndex: number
): Promise<string> => {
  const material = await StudyMaterial.findOne({ _id: materialId, userId });
  if (!material) {
    throw new AppError("Study material not found", 404);
  }

  const card = material.items[cardIndex];
  if (!card) {
    throw new AppError("Card not found in study material", 404);
  }

  const document = await StudyDocument.findById(material.documentId);
  if (!document || !document.extractedText || document.extractedText.trim().length === 0) {
    throw new AppError("Source document text context is empty or unavailable", 400);
  }

  const context = document.extractedText.slice(0, 12000);
  const cardContent = "front" in card
    ? `Front: ${card.front}\nBack: ${card.back}`
    : `Question: ${card.question}\nOptions: ${(card as any).options?.join(", ")}\nCorrect Answer: ${(card as any).options?.[(card as any).correctIndex]}\nExplanation: ${(card as any).explanation}`;

  const systemPrompt = [
    "You are an expert tutor explaining study materials.",
    "Based on the provided CONTEXT, explain the following concept/question in detail.",
    "Structure your explanation clearly with formatting, highlight key terms, and provide grounded facts from the CONTEXT.",
    "Write your entire response in Vietnamese."
  ].join(" ");

  const explanation = await generateGroqText(
    [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `CONTEXT:\n${context}\n\nCONCEPT TO EXPLAIN:\n${cardContent}`,
      },
    ],
    {
      temperature: 0.6,
      maxTokens: 1000,
    }
  );

  return explanation;
};
