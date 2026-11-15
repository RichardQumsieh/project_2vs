import type { AccountArchiveDriveBackup } from "./crypto/account-archive";

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const BACKUP_NAME = "private-messenger-account-archive.backup";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type DriveFile = {
  id: string;
  name: string;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback: (error: { message?: string }) => void;
          }) => {
            requestAccessToken: (options?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

export function isGoogleDriveArchiveConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID);
}

export function loadGoogleIdentityServices() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Drive is available only in a browser."));
  }
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(
      'script[data-private-messenger-google-identity="true"]',
    );
    if (!script) {
      script = document.createElement("script");
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.dataset.privateMessengerGoogleIdentity = "true";
      document.head.append(script);
    }

    script.addEventListener("load", () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error("Google sign-in loaded without its OAuth client."));
    }, { once: true });
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(new Error("Could not load Google sign-in. Check your connection."));
    }, { once: true });
  });
  return scriptPromise;
}

export function requestGoogleDriveAccessToken() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID;
  const tokenClient = window.google?.accounts?.oauth2;
  if (!clientId) {
    return Promise.reject(new Error("Google Drive backup is not configured for this app."));
  }
  if (!tokenClient) {
    return Promise.reject(new Error("Google Drive sign-in is still loading. Please retry."));
  }

  return new Promise<string>((resolve, reject) => {
    const client = tokenClient.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? "Google Drive authorization failed."));
          return;
        }
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? "Google Drive authorization was interrupted."));
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

async function driveRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Google Drive request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : "."}`,
    );
  }
  return response.json() as Promise<T>;
}

async function findBackup(token: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name='${BACKUP_NAME}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: "10",
  });
  const response = await driveRequest<{ files?: DriveFile[] }>(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    token,
  );
  return response.files?.[0] ?? null;
}

export async function uploadGoogleDriveArchiveBackup(
  token: string,
  backup: AccountArchiveDriveBackup,
) {
  const existing = await findBackup(token);
  const boundary = `private_messenger_${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = existing
    ? { name: BACKUP_NAME, mimeType: "application/json" }
    : {
        name: BACKUP_NAME,
        mimeType: "application/json",
        parents: ["appDataFolder"],
      };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(backup),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const fileId = existing?.id;
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
  await driveRequest<{ id: string }>(url, token, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function downloadGoogleDriveArchiveBackup(token: string) {
  const file = await findBackup(token);
  if (!file) throw new Error("No encrypted archive backup was found in this Google Drive account.");
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Could not download the Google Drive archive backup (${response.status})${detail ? `: ${detail.slice(0, 240)}` : "."}`,
    );
  }
  return response.json() as Promise<unknown>;
}
