import { z } from "zod";

const optionalEnvironmentValue = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional(),
);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().regex(/^[\da-fA-F]{64}$/),
  PORT: z.coerce.number().default(3001),
  FRONTEND_ORIGIN: z.string().url(),
  COOKIE_NAME: z.string().default("messenger_session"),
  COOKIE_SECURE: z.enum(["true", "false"])
    .default(process.env.NODE_ENV === "production" ? "true" : "false")
    .transform((value) => value === "true"),
  GMAIL_CLIENT_ID: optionalEnvironmentValue,
  GMAIL_CLIENT_SECRET: optionalEnvironmentValue,
  GMAIL_REFRESH_TOKEN: optionalEnvironmentValue,
  BRAVE_SEARCH_API_KEY: optionalEnvironmentValue,
  SAFE_BROWSING_API_KEY: optionalEnvironmentValue,
  TURN_URLS: optionalEnvironmentValue,
  TURN_SHARED_SECRET: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(32).optional(),
  ),
  GMAIL_SENDER: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().email().optional(),
  ),
  B2_ENDPOINT: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().optional(),
  ),
  B2_REGION: optionalEnvironmentValue,
  B2_BUCKET: optionalEnvironmentValue,
  B2_KEY_ID: optionalEnvironmentValue,
  B2_APPLICATION_KEY: optionalEnvironmentValue,
}).superRefine((values, context) => {
  const gmailValues = [
    values.GMAIL_CLIENT_ID,
    values.GMAIL_CLIENT_SECRET,
    values.GMAIL_REFRESH_TOKEN,
    values.GMAIL_SENDER,
  ];
  const configuredCount = gmailValues.filter(Boolean).length;

  if (configuredCount !== 0 && configuredCount !== gmailValues.length) {
    context.addIssue({
      code: "custom",
      message: "Set all Gmail API variables or leave all of them empty",
      path: ["GMAIL_CLIENT_ID"],
    });
  }

  const b2Values = [
    values.B2_ENDPOINT,
    values.B2_REGION,
    values.B2_BUCKET,
    values.B2_KEY_ID,
    values.B2_APPLICATION_KEY,
  ];
  const b2ConfiguredCount = b2Values.filter(Boolean).length;

  if (b2ConfiguredCount !== 0 && b2ConfiguredCount !== b2Values.length) {
    context.addIssue({
      code: "custom",
      message: "Set all Backblaze B2 variables or leave all of them empty",
      path: ["B2_BUCKET"],
    });
  }

  if (Boolean(values.TURN_URLS) !== Boolean(values.TURN_SHARED_SECRET)) {
    context.addIssue({
      code: "custom",
      message: "Set both TURN_URLS and TURN_SHARED_SECRET, or leave both empty",
      path: ["TURN_URLS"],
    });
  }

  if (
    values.TURN_URLS &&
    values.TURN_URLS.split(",").some((url) => !/^turns?:[^\s,]+$/i.test(url.trim()))
  ) {
    context.addIssue({
      code: "custom",
      message: "TURN_URLS must be a comma-separated list of turn: or turns: URLs",
      path: ["TURN_URLS"],
    });
  }
});

export const env = envSchema.parse(process.env);

export const gmailConfigured = Boolean(
  env.GMAIL_CLIENT_ID &&
  env.GMAIL_CLIENT_SECRET &&
  env.GMAIL_REFRESH_TOKEN &&
  env.GMAIL_SENDER,
);

export const b2Configured = Boolean(
  env.B2_ENDPOINT &&
  env.B2_REGION &&
  env.B2_BUCKET &&
  env.B2_KEY_ID &&
  env.B2_APPLICATION_KEY,
);
