import { z } from 'zod';

export const saveCredentialSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, 'API key is too short or invalid.'),
  provider: z.enum(['gemini']).optional().default('gemini'),
});
