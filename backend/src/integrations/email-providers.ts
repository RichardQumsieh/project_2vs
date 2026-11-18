export type EmailProviderId = "gmail" | "outlook-mail";

export type EmailProviderConfig = {
  id: EmailProviderId;
  prismaProvider: "GMAIL" | "OUTLOOK_MAIL";
  label: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
};

export const emailProviders: Record<EmailProviderId, EmailProviderConfig> = {
  gmail: {
    id: "gmail",
    prismaProvider: "GMAIL",
    label: "Gmail",
    // readonly for metadata sync; compose keeps drafts; send delivers approved mail.
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
  },
  "outlook-mail": {
    id: "outlook-mail",
    prismaProvider: "OUTLOOK_MAIL",
    label: "Outlook Mail",
    // Mail.ReadWrite keeps drafts. Mail.Send delivers approved mail.
    scopes: ["offline_access", "Mail.ReadWrite", "Mail.Send", "User.Read"],
    authorizeUrl:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  },
};

export function parseEmailProvider(value: string): EmailProviderId | null {
  if (value === "gmail" || value === "outlook-mail") {
    return value;
  }
  return null;
}

export const GMAIL_LIST_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export const OUTLOOK_MAIL_LIST_URL =
  "https://graph.microsoft.com/v1.0/me/messages";
