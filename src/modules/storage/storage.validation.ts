import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

const orderRefSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,34}$/, { message: "Invalid order reference" });

export const createPurchaseSchema = z.object({
  body: z.object({
    packageId: objectIdSchema,
    platform: z.enum(["WEB", "MOBILE"]).optional(),
    clientReturnUrl: z.string().trim().url().max(2048).optional(),
  }),
});

export const orderRefParamSchema = z.object({
  params: z.object({
    orderRef: orderRefSchema,
  }),
});

export const listTransactionsSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z
      .enum(["PENDING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"])
      .optional(),
  }),
});
