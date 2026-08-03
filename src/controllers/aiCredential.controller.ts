import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendResponse } from '../utils/apiResponse';
import {
  saveCredential,
  getCredentialStatus,
  deleteCredential,
} from '../services/aiCredential.service';
import { getUsage } from '../services/aiUsage.service';
import { saveCredentialSchema } from '../validations/aiCredential.validation';

export const saveCredentialHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const payload = saveCredentialSchema.parse(req.body);
    const data = await saveCredential(
      req.authUser!.id,
      payload.apiKey,
      payload.provider,
    );

    sendResponse(res, 200, {
      success: true,
      message: 'AI credential saved and validated successfully',
      data,
    });
  },
);

export const getCredentialStatusHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data = await getCredentialStatus(req.authUser!.id);

    sendResponse(res, 200, {
      success: true,
      message: 'Credential status retrieved successfully',
      data,
    });
  },
);

export const getUsageHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const isAdmin = String(req.authUser?.role).toLowerCase() === 'admin';
    const data = await getUsage(req.authUser!.id, isAdmin);

    sendResponse(res, 200, {
      success: true,
      message: 'AI usage retrieved successfully',
      data,
    });
  },
);

export const deleteCredentialHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    await deleteCredential(req.authUser!.id);

    sendResponse(res, 200, {
      success: true,
      message: 'Credential removed successfully',
    });
  },
);
