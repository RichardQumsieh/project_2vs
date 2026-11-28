"use client";

import { memo, useMemo } from "react";
import { Trash2 } from "lucide-react";
import { EncryptedAlbum } from "@/components/encrypted-album";
import { EncryptedFileAttachment } from "@/components/encrypted-file-attachment";
import { EncryptedLocation } from "@/components/encrypted-location";
import { EncryptedPhoto } from "@/components/encrypted-photo";
import { EncryptedVideo } from "@/components/encrypted-video";
import { EncryptedVoiceNote } from "@/components/encrypted-voice-note";
import { LinkSafetyText } from "@/components/link-safety-text";
import { CallLogBlock } from "@/components/call-log";
import { ReplyQuoteBlock } from "@/components/reply-quote";
import { parseChatPayload } from "@/lib/chat-payload";
import type { LocalMessage } from "@/lib/crypto/types";
import { useI18n } from "@/lib/i18n/locale";

type ThreadMessageListProps = {
  messages: readonly LocalMessage[];
  conversationId: string;
  replySelectMode: boolean;
  selectedReplyIds: readonly string[];
  confirmDeleteId: string | null;
  deleteMessageError: string | null;
  deletePending: boolean;
  onToggleReply: (messageId: string) => void;
  onAskDelete: (messageId: string) => void;
  onConfirmDelete: (message: LocalMessage) => void;
  onCancelDelete: () => void;
};

export const ThreadMessageList = memo(function ThreadMessageList({
  messages,
  conversationId,
  replySelectMode,
  selectedReplyIds,
  confirmDeleteId,
  deleteMessageError,
  deletePending,
  onToggleReply,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: ThreadMessageListProps) {
  const selected = useMemo(() => new Set(selectedReplyIds), [selectedReplyIds]);
  return (
    <>
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          conversationId={conversationId}
          replySelectMode={replySelectMode}
          selected={selected.has(message.id)}
          confirming={confirmDeleteId === message.id}
          deleteMessageError={confirmDeleteId === message.id ? deleteMessageError : null}
          deletePending={deletePending}
          onToggleReply={onToggleReply}
          onAskDelete={onAskDelete}
          onConfirmDelete={onConfirmDelete}
          onCancelDelete={onCancelDelete}
        />
      ))}
    </>
  );
});

const MessageRow = memo(function MessageRow({
  message,
  conversationId,
  replySelectMode,
  selected,
  confirming,
  deleteMessageError,
  deletePending,
  onToggleReply,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  message: LocalMessage;
  conversationId: string;
  replySelectMode: boolean;
  selected: boolean;
  confirming: boolean;
  deleteMessageError: string | null;
  deletePending: boolean;
  onToggleReply: (messageId: string) => void;
  onAskDelete: (messageId: string) => void;
  onConfirmDelete: (message: LocalMessage) => void;
  onCancelDelete: () => void;
}) {
  const payload = parseChatPayload(message.plaintext);
  const { t } = useI18n();
  return (
    <div
      className={`thread-message group relative max-w-[88%] rounded-[1.35rem] px-3.5 py-2.5 text-sm sm:max-w-[72%] sm:px-4 sm:py-3 ${
        message.fromMe
          ? "ms-auto bg-gradient-to-br from-white to-[#e8eef8] text-black"
          : "border border-white/10 bg-[#141b27] text-white/90"
      } ${selected ? "ring-2 ring-cyan-300/50" : ""}`}
    >
      {payload.type === "image" ? (
        <EncryptedPhoto
          conversationId={conversationId}
          payload={payload}
          fromMe={message.fromMe}
        />
      ) : payload.type === "album" ? (
        <EncryptedAlbum
          conversationId={conversationId}
          payload={payload}
          fromMe={message.fromMe}
        />
      ) : payload.type === "video" ? (
        <EncryptedVideo conversationId={conversationId} payload={payload} />
      ) : payload.type === "voice" ? (
        <EncryptedVoiceNote conversationId={conversationId} payload={payload} />
      ) : payload.type === "file" ? (
        <EncryptedFileAttachment conversationId={conversationId} payload={payload} />
      ) : payload.type === "location" ? (
        <EncryptedLocation payload={payload} fromMe={message.fromMe} />
      ) : payload.type === "reply" ? (
        <ReplyQuoteBlock payload={payload} fromMe={message.fromMe} />
      ) : payload.type === "call" ? (
        <CallLogBlock payload={payload} />
      ) : payload.type === "system" ? (
        <p>{payload.actor ? `${payload.actor}: ` : ""}{payload.event}</p>
      ) : payload.type === "waiting" ? (
        <p>Waiting for this message</p>
      ) : (
        <LinkSafetyText text={payload.text} />
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {replySelectMode ? (
          <label className={`flex items-center gap-2 text-[11px] ${message.fromMe ? "text-black/55" : "text-white/55"}`}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleReply(message.id)}
            />
            {t("chat.includeReply")}
          </label>
        ) : (
          <span />
        )}
        {message.fromMe ? (
          <div className="flex justify-end">
            {confirming ? (
              <div className="flex items-center gap-2 rounded-full bg-black/10 px-2 py-1 text-[11px]">
                <span>{t("chat.deletePrompt")}</span>
                {deleteMessageError ? (
                  <span role="alert" className="text-red-700">
                    {deleteMessageError}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={deletePending}
                  className="rounded-full bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  onClick={() => onConfirmDelete(message)}
                >
                  {deletePending ? t("chat.deleting") : t("chat.delete")}
                </button>
                <button
                  type="button"
                  disabled={deletePending}
                  className="rounded-full px-2 py-1 text-black/60 hover:bg-black/10 disabled:opacity-50"
                  onClick={onCancelDelete}
                >
                  {t("chat.cancel")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                aria-label={t("chat.deleteAria")}
                title={t("chat.deleteTitle")}
                disabled={deletePending}
                className="rounded-full p-1.5 text-black/45 opacity-70 transition-opacity hover:bg-black/10 hover:text-black focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-black/50 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-40"
                onClick={() => onAskDelete(message.id)}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});
