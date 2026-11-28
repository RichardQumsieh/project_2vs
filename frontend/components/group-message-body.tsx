"use client";

import { EncryptedAlbum } from "@/components/encrypted-album";
import { EncryptedFileAttachment } from "@/components/encrypted-file-attachment";
import { EncryptedPhoto } from "@/components/encrypted-photo";
import { EncryptedVideo } from "@/components/encrypted-video";
import { EncryptedVoiceNote } from "@/components/encrypted-voice-note";
import { LinkSafetyText } from "@/components/link-safety-text";
import { CallLogBlock } from "@/components/call-log";
import { ReplyQuoteBlock } from "@/components/reply-quote";
import { parseChatPayload, systemMessageText } from "@/lib/chat-payload";
import { mentionParts } from "@/lib/group-presentation";
import { BidiText } from "@/lib/i18n/bidi";

export function GroupMessageBody({
  conversationId,
  plaintext,
  fromMe,
  usernames = [],
  onRetry,
}: {
  conversationId: string;
  plaintext: string;
  fromMe: boolean;
  usernames?: readonly string[];
  onRetry?: () => void;
}) {
  const payload = parseChatPayload(plaintext);
  if (payload.type === "image") {
    return (
      <EncryptedPhoto
        conversationId={conversationId}
        payload={payload}
        fromMe={fromMe}
      />
    );
  }
  if (payload.type === "album") {
    return (
      <EncryptedAlbum
        conversationId={conversationId}
        payload={payload}
        fromMe={fromMe}
      />
    );
  }
  if (payload.type === "video") {
    return <EncryptedVideo conversationId={conversationId} payload={payload} />;
  }
  if (payload.type === "voice") {
    return <EncryptedVoiceNote conversationId={conversationId} payload={payload} />;
  }
  if (payload.type === "file") {
    return <EncryptedFileAttachment conversationId={conversationId} payload={payload} />;
  }
  if (payload.type === "reply") {
    return <ReplyQuoteBlock payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "call") {
    return <CallLogBlock payload={payload} />;
  }
  if (payload.type === "system") {
    return <p className="text-center text-xs text-white/55">{systemMessageText(payload)}</p>;
  }
  if (payload.type === "waiting") {
    return (
      <div className="space-y-2">
        <p>Waiting for this message</p>
        {onRetry ? (
          <button type="button" className="text-xs font-medium underline" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (payload.type === "location") {
    return (
      <p className="whitespace-pre-wrap break-words text-sm text-white/70">
        <BidiText>{payload.name?.trim() || "Shared location"}</BidiText>
      </p>
    );
  }
  return <MentionText text={payload.text} usernames={usernames} />;
}

function MentionText({ text, usernames }: { text: string; usernames: readonly string[] }) {
  const parts = mentionParts(text, usernames);
  if (parts.length === 1 && parts[0]?.kind === "text") return <LinkSafetyText text={text} />;
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => part.kind === "mention"
        ? <span key={`${part.value}-${index}`} className="font-semibold text-cyan-200">{part.value}</span>
        : <span key={`${index}-${part.value.slice(0, 12)}`}>{part.value}</span>)}
    </p>
  );
}
