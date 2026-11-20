"use client";

import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LinkSafetyText } from "@/components/link-safety-text";
import { api } from "@/lib/api";
import type { FileChatPayload } from "@/lib/chat-payload";
import {
  decryptFileAttachment,
  maxEncryptedFileAttachmentBytes,
} from "@/lib/crypto/file-attachment";
import { LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

function saveAttachment(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function EncryptedFileAttachment({
  conversationId,
  payload,
}: {
  conversationId: string;
  payload: FileChatPayload;
}) {
  const { t } = useI18n();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<MessageKey | null>(null);
  async function downloadFile() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const { downloadUrl } = await api.mediaDownload(conversationId, payload.id);
      const response = await fetch(downloadUrl, {
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        setDownloadError("chat.fileDownloadMissing");
        return;
      }
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        (!/^\d+$/.test(contentLength) ||
          Number(contentLength) !== payload.bytes ||
          Number(contentLength) > maxEncryptedFileAttachmentBytes)
      ) {
        setDownloadError("chat.fileSizeInvalid");
        return;
      }
      const ciphertext = await response.arrayBuffer();
      if (
        ciphertext.byteLength !== payload.bytes ||
        ciphertext.byteLength > maxEncryptedFileAttachmentBytes
      ) {
        setDownloadError("chat.fileSizeInvalid");
        return;
      }
      const blob = await decryptFileAttachment(ciphertext, payload.k, payload.n);
      saveAttachment(blob, payload.name);
    } catch {
      setDownloadError("chat.fileDownloadFailed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="min-w-0 space-y-2" aria-label={t("chat.fileAttachment")}>
      <div className="flex min-w-0 items-center gap-2">
        <FileText aria-hidden="true" className="size-5 shrink-0 opacity-60" />
        <p className="min-w-0 flex-1 truncate font-medium" title={payload.name}>
          <LtrIsolate>{payload.name}</LtrIsolate>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0"
          aria-label={t("chat.downloadFile", { name: payload.name })}
          disabled={downloading}
          onClick={() => void downloadFile()}
        >
          <Download aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <p className="text-xs opacity-60">
        {t("chat.fileMeta", { bytes: (payload.bytes - 16).toLocaleString() })}
      </p>
      {payload.caption?.trim() ? (
        <LinkSafetyText text={payload.caption} />
      ) : null}
      <p className="text-xs text-amber-700 dark:text-amber-200">
        {t("chat.fileWarning")}
      </p>
      {payload.containsExternalLinks ? (
        <p role="alert" className="text-xs font-medium text-amber-700 dark:text-amber-200">
          {t("chat.fileExternal")}
        </p>
      ) : null}
      {downloadError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">
          {t(downloadError)}
        </p>
      ) : null}
    </section>
  );
}
