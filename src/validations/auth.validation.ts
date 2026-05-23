import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(2).max(80),
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(6).max(100),
    avatar: z.string().trim().url().optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(1),
  }),
});

export const updateProfileSchema = z.object({
  body: z
    .object({
      fullName: z.string().trim().min(2).max(80).optional(),
      avatar: z.string().trim().url().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email().toLowerCase(),
  }),
});
