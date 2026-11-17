import { z } from "zod";
import { passwordPolicyFailure } from "./password-policy";

export const signupSchema = z.object({
  username: z
    .string()
    .min(3, "At least 3 characters")
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only"),
  displayName: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().max(128),
  passwordConfirm: z.string().min(1, "Repeat your password"),
}).refine(
  ({ password, passwordConfirm }) =>
    password === passwordConfirm,
  {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  },
).refine(
  ({ password, email }) => passwordPolicyFailure(password, email) === null,
  {
    message: "Password does not meet the strength rules.",
    path: ["password"],
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
  password: z.string().max(128, "Use at most 128 characters."),
  passwordConfirm: z.string().min(1, "Repeat your password"),
  code: z.string().min(1, "Enter your authenticator or backup code").max(32),
}).refine(
  ({ password, passwordConfirm }) =>
    password === passwordConfirm,
  {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  },
).refine(
  ({ password }) => passwordPolicyFailure(password) === null,
  {
    message: "Password does not meet the strength rules.",
    path: ["password"],
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
