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
  /** Public API origin used to build OAuth redirect_uri (e.g. https://api.example.com). */
  API_PUBLIC_ORIGIN: optionalEnvironmentValue,
  GOOGLE_CALENDAR_CLIENT_ID: optionalEnvironmentValue,
  GOOGLE_CALENDAR_CLIENT_SECRET: optionalEnvironmentValue,
  MICROSOFT_CALENDAR_CLIENT_ID: optionalEnvironmentValue,
  MICROSOFT_CALENDAR_CLIENT_SECRET: optionalEnvironmentValue,
  /** Per-user Gmail read OAuth (separate from server GMAIL_* recovery sender). */
  GOOGLE_MAIL_CLIENT_ID: optionalEnvironmentValue,
  GOOGLE_MAIL_CLIENT_SECRET: optionalEnvironmentValue,
  MICROSOFT_MAIL_CLIENT_ID: optionalEnvironmentValue,
  MICROSOFT_MAIL_CLIENT_SECRET: optionalEnvironmentValue,
  GITHUB_OAUTH_CLIENT_ID: optionalEnvironmentValue,
  GITHUB_OAUTH_CLIENT_SECRET: optionalEnvironmentValue,
  LINEAR_OAUTH_CLIENT_ID: optionalEnvironmentValue,
  LINEAR_OAUTH_CLIENT_SECRET: optionalEnvironmentValue,
  SLACK_OAUTH_CLIENT_ID: optionalEnvironmentValue,
  SLACK_OAUTH_CLIENT_SECRET: optionalEnvironmentValue,
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

  const googleCalendarPair = [
    values.GOOGLE_CALENDAR_CLIENT_ID,
    values.GOOGLE_CALENDAR_CLIENT_SECRET,
  ];
  const googleCalendarCount = googleCalendarPair.filter(Boolean).length;
  if (googleCalendarCount !== 0 && googleCalendarCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET, or leave both empty",
      path: ["GOOGLE_CALENDAR_CLIENT_ID"],
    });
  }

  const microsoftCalendarPair = [
    values.MICROSOFT_CALENDAR_CLIENT_ID,
    values.MICROSOFT_CALENDAR_CLIENT_SECRET,
  ];
  const microsoftCalendarCount = microsoftCalendarPair.filter(Boolean).length;
  if (microsoftCalendarCount !== 0 && microsoftCalendarCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both MICROSOFT_CALENDAR_CLIENT_ID and MICROSOFT_CALENDAR_CLIENT_SECRET, or leave both empty",
      path: ["MICROSOFT_CALENDAR_CLIENT_ID"],
    });
  }

  const googleMailPair = [
    values.GOOGLE_MAIL_CLIENT_ID,
    values.GOOGLE_MAIL_CLIENT_SECRET,
  ];
  const googleMailCount = googleMailPair.filter(Boolean).length;
  if (googleMailCount !== 0 && googleMailCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both GOOGLE_MAIL_CLIENT_ID and GOOGLE_MAIL_CLIENT_SECRET, or leave both empty",
      path: ["GOOGLE_MAIL_CLIENT_ID"],
    });
  }

  const microsoftMailPair = [
    values.MICROSOFT_MAIL_CLIENT_ID,
    values.MICROSOFT_MAIL_CLIENT_SECRET,
  ];
  const microsoftMailCount = microsoftMailPair.filter(Boolean).length;
  if (microsoftMailCount !== 0 && microsoftMailCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both MICROSOFT_MAIL_CLIENT_ID and MICROSOFT_MAIL_CLIENT_SECRET, or leave both empty",
      path: ["MICROSOFT_MAIL_CLIENT_ID"],
    });
  }

  const githubPair = [
    values.GITHUB_OAUTH_CLIENT_ID,
    values.GITHUB_OAUTH_CLIENT_SECRET,
  ];
  const githubCount = githubPair.filter(Boolean).length;
  if (githubCount !== 0 && githubCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or leave both empty",
      path: ["GITHUB_OAUTH_CLIENT_ID"],
    });
  }

  const linearPair = [
    values.LINEAR_OAUTH_CLIENT_ID,
    values.LINEAR_OAUTH_CLIENT_SECRET,
  ];
  const linearCount = linearPair.filter(Boolean).length;
  if (linearCount !== 0 && linearCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both LINEAR_OAUTH_CLIENT_ID and LINEAR_OAUTH_CLIENT_SECRET, or leave both empty",
      path: ["LINEAR_OAUTH_CLIENT_ID"],
    });
  }

  const slackPair = [
    values.SLACK_OAUTH_CLIENT_ID,
    values.SLACK_OAUTH_CLIENT_SECRET,
  ];
  const slackCount = slackPair.filter(Boolean).length;
  if (slackCount !== 0 && slackCount !== 2) {
    context.addIssue({
      code: "custom",
      message:
        "Set both SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_CLIENT_SECRET, or leave both empty",
      path: ["SLACK_OAUTH_CLIENT_ID"],
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

export const googleCalendarOAuthConfigured = Boolean(
  env.GOOGLE_CALENDAR_CLIENT_ID &&
  env.GOOGLE_CALENDAR_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);

export const microsoftCalendarOAuthConfigured = Boolean(
  env.MICROSOFT_CALENDAR_CLIENT_ID &&
  env.MICROSOFT_CALENDAR_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);

export const gmailOAuthConfigured = Boolean(
  env.GOOGLE_MAIL_CLIENT_ID &&
  env.GOOGLE_MAIL_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);

export const microsoftMailOAuthConfigured = Boolean(
  env.MICROSOFT_MAIL_CLIENT_ID &&
  env.MICROSOFT_MAIL_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);

export const githubOAuthConfigured = Boolean(
  env.GITHUB_OAUTH_CLIENT_ID &&
  env.GITHUB_OAUTH_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);

export const linearOAuthConfigured = Boolean(
  env.LINEAR_OAUTH_CLIENT_ID &&
  env.LINEAR_OAUTH_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);

export const slackOAuthConfigured = Boolean(
  env.SLACK_OAUTH_CLIENT_ID &&
  env.SLACK_OAUTH_CLIENT_SECRET &&
  env.API_PUBLIC_ORIGIN,
);
