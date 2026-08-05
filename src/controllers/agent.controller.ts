import { Request, Response } from "express";
import { AskQuestionRequest } from "../types/api.types";
import { askQuestionWithAgent } from "../services/agenticRag.service";
import { sendResponse } from "../utils/apiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { resolveCredentialForUser, runWithCredential } from "../services/aiCredentialContext";
import { assertQuotaAvailable, recordMessage } from "../services/aiUsage.service";
import { describeProviderError } from "../utils/providerError";

export const ask = asyncHandler(async (
  req: Request<unknown, unknown, AskQuestionRequest>,
  res: Response,
): Promise<void> => {
  const isAdmin = String(req.authUser?.role).toLowerCase() === "admin";
  const credential = await resolveCredentialForUser(req.authUser?.id);
  await assertQuotaAvailable(req.authUser!.id, credential, isAdmin);

  await runWithCredential(credential, async () => {
    const data = await askQuestionWithAgent(req.authUser!.id, req.body);
    await recordMessage(req.authUser!.id, { degraded: credential.degraded });

    sendResponse(res, 200, {
      success: true,
      message: "Question answered successfully",
      data,
    });
  });
});

export const askStream = asyncHandler(async (
  req: Request<unknown, unknown, AskQuestionRequest>,
  res: Response,
): Promise<void> => {
  const isAdmin = String(req.authUser?.role).toLowerCase() === "admin";
  const credential = await resolveCredentialForUser(req.authUser?.id);
  await assertQuotaAvailable(req.authUser!.id, credential, isAdmin);

  await runWithCredential(credential, async () => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const abortController = new AbortController();
    req.on("close", () => {
      abortController.abort();
    });

    const pingInterval = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    try {
      if (credential.degraded) {
        res.write(
          `data: ${JSON.stringify({
            type: "notice",
            code: "DEGRADED_MODE",
            message: "Your custom API key failed. Operating on free allowance.",
          })}\n\n`,
        );
      }

      await askQuestionWithAgent(req.authUser!.id, req.body, {
        onEvent: (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        signal: abortController.signal,
      });
      await recordMessage(req.authUser!.id, { degraded: credential.degraded });
    } catch (err: any) {
      if (err.name === "AbortError" || (err instanceof DOMException && err.name === "AbortError")) {
        // Stream aborted by client - nothing to write since connection is closed
        return;
      }
      // Raw provider errors carry the request URL, the internal model id, and
      // billing console links, so they are rewritten rather than forwarded.
      // The original is on `err` and reaches the log; only this crosses the
      // wire. An AppError that already carries its own code was raised by us
      // and is safe to send as-is.
      console.error("askStream failed:", err);
      const described = err.code
        ? { code: err.code, message: err.message }
        : describeProviderError(err, credential.source);

      res.write(
        `data: ${JSON.stringify({
          type: "error",
          code: described.code,
          message: described.message,
        })}\n\n`,
      );
    } finally {
      clearInterval(pingInterval);
      res.end();
    }
  });
});

