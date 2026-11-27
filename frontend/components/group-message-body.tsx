"use client";

import { EncryptedAlbum } from "@/components/encrypted-album";
import { EncryptedFileAttachment } from "@/components/encrypted-file-attachment";
import { EncryptedPhoto } from "@/components/encrypted-photo";
import { EncryptedVideo } from "@/components/encrypted-video";
import { EncryptedVoiceNote } from "@/components/encrypted-voice-note";
import { LinkSafetyText } from "@/components/link-safety-text";
import { CallLogBlock } from "@/components/call-log";
import { ReplyQuoteBlock } from "@/components/reply-quote";
import { parseChatPayload } from "@/lib/chat-payload";
import { BidiText } from "@/lib/i18n/bidi";

export function GroupMessageBody({
  conversationId,
  plaintext,
  fromMe,
}: {
  conversationId: string;
  plaintext: string;
  fromMe: boolean;
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
  if (payload.type === "location") {
    return (
      <p className="whitespace-pre-wrap break-words text-sm text-white/70">
        <BidiText>{payload.name?.trim() || "Shared location"}</BidiText>
      </p>
    );
  }
  return <LinkSafetyText text={payload.text} />;
}
