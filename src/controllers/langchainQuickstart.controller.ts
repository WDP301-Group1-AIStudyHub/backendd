import { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import * as wrappers from "langsmith/wrappers";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";

import { resolveCredentialForUser, runWithCredential, requireCredential } from "../services/aiCredentialContext";

/**
 * Controller to test LangChain & LangSmith integration.
 * Makes a traced Gemini call using the Google GenAI SDK.
 */
export const testLangChainIntegration = asyncHandler(async (
  req: Request<unknown, unknown, { prompt?: string }>,
  res: Response,
): Promise<void> => {
  const credential = await resolveCredentialForUser(req.authUser?.id);
  await runWithCredential(credential, async () => {
    const apiKey = requireCredential().apiKey;
    const geminiClient = new GoogleGenAI({ apiKey });
    const client = wrappers.wrapSDK(geminiClient, {
      tags: ["gemini", "typescript", "quickstart"],
      metadata: {
        integration: "google-genai",
      },
    });

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
});
