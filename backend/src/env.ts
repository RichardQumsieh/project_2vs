import { z } from "zod";
import { parseDailyBriefEnabled } from "./daily-brief-flag.js";
import { parseSafetyNumbersEnabled } from "./safety-numbers.js";
import { assertProductionCookieSecure, parseTrustProxy } from "./security-config.js";

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
  /**
   * Comma-separated reverse-proxy IPs or CIDRs. Empty ignores X-Forwarded-*.
   * The value "true" is rejected.
   */
  TRUST_PROXY: optionalEnvironmentValue,
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
  /**
   * Phase 4.2 owner-scoped write APIs (calendar/email/work/slack).
   * Default OFF until provider consoles are upgraded and operators opt in.
   */
  INTEGRATIONS_WRITE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Optional dogfood allowlist. When non-empty, writes stay limited to these
   * user ids, usernames, or emails even if the master flag is on.
   * The flag still has to be true; this list never turns writes on by itself.
   */
  INTEGRATIONS_WRITE_ALLOWLIST: z.string().optional().default(""),
  /**
   * Small-group MLS (RFC 9420). Default OFF. The API stores opaque MLS
   * messages only; it cannot decrypt them. See docs/group-e2ee.md.
   */
  GROUP_E2EE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Manager daily brief. On unless the value is exactly "false".
   * Reads connected mail and calendar mirrors only. Suggested sends and
   * calendar changes still require the existing approval path.
   * See docs/daily-brief.md.
   */
  DAILY_BRIEF_ENABLED: z.preprocess(
    (value) => parseDailyBriefEnabled(value),
    z.boolean(),
  ),
  /**
   * Public identity-key directory used for safety numbers. On unless the
   * value is exactly "false". The route returns no private keys and does
   * not consume one-time prekeys.
   */
  SAFETY_NUMBERS_ENABLED: z.preprocess(
    (value) => parseSafetyNumbersEnabled(value),
    z.boolean(),
  ),
  /**
   * Workspace billing. Default off: no checkout and no charge.
   * mock never calls a provider. stripe calls Stripe only when the secret
   * and price ids below are set. See docs/billing.md.
   */
  BILLING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BILLING_PROVIDER: z.enum(["mock", "stripe"]).default("mock"),
  STRIPE_SECRET_KEY: optionalEnvironmentValue,
  STRIPE_WEBHOOK_SECRET: optionalEnvironmentValue,
  STRIPE_PRICE_FAMILY_PLUS: optionalEnvironmentValue,
  STRIPE_PRICE_TEAM_SEAT: optionalEnvironmentValue,
  BRAVE_SEARCH_API_KEY: optionalEnvironmentValue,
  /** Hosted Sophia model. Both key and HTTPS base URL are required before any call. */
  SOPHIA_MODEL_API_KEY: optionalEnvironmentValue,
  SOPHIA_MODEL_BASE_URL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().url().optional(),
  ),
  SOPHIA_MODEL_NAME: optionalEnvironmentValue,
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

  if (values.SOPHIA_MODEL_BASE_URL) {
    const base = new URL(values.SOPHIA_MODEL_BASE_URL);
    if (base.protocol !== "https:" || base.username || base.password) {
      context.addIssue({
        code: "custom",
        message: "SOPHIA_MODEL_BASE_URL must be an https URL without credentials",
        path: ["SOPHIA_MODEL_BASE_URL"],
      });
    }
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

const parsedEnv = envSchema.parse(process.env);
assertProductionCookieSecure(process.env.NODE_ENV, parsedEnv.COOKIE_SECURE);

export const env = parsedEnv;

/** `false`, or a comma-separated list of proxy addresses Fastify may trust. */
export const trustProxy = parseTrustProxy(env.TRUST_PROXY);

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

/** Master feature flag for Phase 4.2 provider write routes (default false). */
export const integrationsWriteEnabled = env.INTEGRATIONS_WRITE_ENABLED;

/** Lowercased user ids, usernames, or emails. Empty means every account, once the flag is on. */
export const integrationsWriteAllowlist = env.INTEGRATIONS_WRITE_ALLOWLIST
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter((entry) => entry.length > 0);

/** Small-group MLS delivery. Default false. See docs/group-e2ee.md. */
export const groupE2eeEnabled = env.GROUP_E2EE_ENABLED;

/** Manager daily brief. On unless DAILY_BRIEF_ENABLED is exactly "false". */
export const dailyBriefEnabled = env.DAILY_BRIEF_ENABLED;

/** Safety-number identity directory. On unless SAFETY_NUMBERS_ENABLED is "false". */
export const safetyNumbersEnabled = env.SAFETY_NUMBERS_ENABLED;

/** Workspace charges. Off unless BILLING_ENABLED is exactly "true". */
export const billingEnabled = env.BILLING_ENABLED;
