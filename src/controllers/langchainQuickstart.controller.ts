import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import * as wrappers from "langsmith/wrappers";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

// Initialize the GoogleGenAI client with the Gemini API key
const geminiClient = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Wrap the Gemini client to enable LangSmith tracing
const client = wrappers.wrapSDK(geminiClient, {
  tags: ["gemini", "typescript", "quickstart"],
  metadata: {
    integration: "google-genai",
  },
});

/**
 * Controller to test LangChain & LangSmith integration.
 * Makes a traced Gemini call using the Google GenAI SDK.
 */
export const testLangChainIntegration = asyncHandler(async (
  req: Request<unknown, unknown, { prompt?: string }>,
  res: Response,
): Promise<void> => {
  const prompt = req.body.prompt || "Explain quantum computing in simple terms.";

  // Make a traced Gemini call
  const response = await client.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: prompt,
  });

  console.log("Gemini Quickstart Response text:", response.text);

  sendResponse(res, 200, {
    success: true,
    message: "LangChain/LangSmith integration working!",
    data: {
      prompt,
      response: response.text,
    },
  });
});
