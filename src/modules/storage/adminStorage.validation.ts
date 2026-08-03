import { z } from "zod";

const objectIdSchema = z.string().trim().regex(/^[0-9a-fA-F]{24}$/, {
  message: "Invalid ObjectId",
});

const pagination = {
  page: z.string().optional(),
  limit: z.string().optional(),
};

const dateQuery = z.string().trim().optional();

export const adminStorageUsersSchema = z.object({
  query: z.object({
    ...pagination,
    search: z.string().trim().optional(),
    packageId: objectIdSchema.optional(),
    status: z.enum(["OK", "WARNING", "CRITICAL", "FULL"]).optional(),
  }),
});

export const adminStorageUserParamSchema = z.object({
  params: z.object({ userId: objectIdSchema }),
});

export const adminStoragePackageParamSchema = z.object({
  params: z.object({ packageId: objectIdSchema }),
});

export const adminStoragePackageChangeSchema = z.object({
  params: z.object({ userId: objectIdSchema }),
  body: z.object({
    packageId: objectIdSchema,
    reason: z.string().trim().min(1).max(500),
  }),
});

export const adminStoragePackageCreateSchema = z.object({
  body: z.object({
    code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(100),
    capacityBytes: z.number().finite().min(0),
    priceVnd: z.number().finite().min(0),
    description: z.string().trim().max(500).optional(),
    features: z.array(z.string().trim().min(1).max(200)).optional(),
    sortOrder: z.number().int().optional(),
    highlight: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  }),
});

export const adminStoragePackageUpdateSchema = z.object({
  params: z.object({ packageId: objectIdSchema }),
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      capacityBytes: z.number().finite().min(0).optional(),
      priceVnd: z.number().finite().min(0).optional(),
      description: z.string().trim().max(500).optional(),
      features: z.array(z.string().trim().min(1).max(200)).optional(),
      sortOrder: z.number().int().optional(),
      highlight: z.boolean().optional(),
      isActive: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one package field is required",
    }),
});

export const adminPaymentsOverviewSchema = z.object({
  query: z.object({ dateFrom: dateQuery, dateTo: dateQuery }),
});

export const adminPaymentsTransactionsSchema = z.object({
  query: z.object({
    ...pagination,
    status: z
      .enum(["PENDING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED"])
      .optional(),
    provider: z.enum(["VNPAY", "MOCK"]).optional(),
    platform: z.enum(["WEB", "MOBILE"]).optional(),
    packageId: objectIdSchema.optional(),
    userId: objectIdSchema.optional(),
    orderRef: z.string().trim().max(64).optional(),
    search: z.string().trim().max(120).optional(),
    dateFrom: dateQuery,
    dateTo: dateQuery,
  }),
});

export const adminPaymentOrderRefSchema = z.object({
  params: z.object({ orderRef: z.string().trim().min(1).max(64) }),
});

export const adminPaymentCancelSchema = z.object({
  params: z.object({ orderRef: z.string().trim().min(1).max(64) }),
  body: z.object({ reason: z.string().trim().min(1).max(500) }),
});
