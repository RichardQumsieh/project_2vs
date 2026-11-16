import { z } from "zod";

export const signupSchema = z.object({
  username: z
    .string()
    .min(3, "At least 3 characters")
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only"),
  displayName: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(12, "Use at least 12 characters").max(128),
  passwordConfirm: z.string().min(1, "Repeat your password"),
}).refine(
  ({ password, passwordConfirm }) =>
    password === passwordConfirm,
  {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  },
);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  code: z.string().max(32).optional(),
  trustBrowser: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(12, "Use at least 12 characters").max(128),
  passwordConfirm: z.string().min(1, "Repeat your password"),
  code: z.string().min(1, "Enter your authenticator or recovery code").max(32),
}).refine(
  ({ password, passwordConfirm }) =>
    password === passwordConfirm,
  {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  },
);

export const unlockSchema = z.object({
  password: z.string().min(1),
});

export const usernameSchema = z.object({
  username: z.string().min(3).max(24),
});

export const messageSchema = z.object({
  body: z.string().min(1).max(4000),
});
