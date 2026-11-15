"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { VoiceChatPayload } from "@/lib/chat-payload";
import {
  decryptVoiceNoteBytes,
  maxVoiceNoteSourceBytes,
} from "@/lib/crypto/voice-note";
import { LinkSafetyText } from "@/components/link-safety-text";

export function EncryptedVoiceNote({
  conversationId,
  payload,
}: {
  conversationId: string;
  payload: VoiceChatPayload;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const voice = useQuery({
    queryKey: ["encrypted-voice-note", conversationId, payload.id],
    queryFn: async () => {
      const { downloadUrl } = await api.mediaDownload(conversationId, payload.id);
      const response = await fetch(downloadUrl, { cache: "no-store", redirect: "error" });
      if (!response.ok) {
        throw new Error("The voice note could not be downloaded.");
      }
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        (!/^\d+$/.test(contentLength) ||
          Number(contentLength) !== payload.bytes ||
          Number(contentLength) > maxVoiceNoteSourceBytes + 16)
      ) {
        throw new Error("The downloaded voice note has an invalid size.");
      }
      const ciphertext = new Uint8Array(await response.arrayBuffer());
      if (
        ciphertext.byteLength !== payload.bytes ||
        ciphertext.byteLength > maxVoiceNoteSourceBytes + 16
      ) {
        throw new Error("The downloaded voice note has an invalid size.");
      }
      return decryptVoiceNoteBytes(ciphertext, payload.k, payload.n, payload.mime);
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    const element = audioRef.current;
    if (!voice.data || !element) return;
    const url = URL.createObjectURL(voice.data);
    element.src = url;
    return () => {
      element.pause();
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [voice.data]);

  if (voice.isPending) {
    return <p className="text-xs opacity-60">Loading voice note…</p>;
  }
  if (voice.isError || !voice.data) {
    return (
      <p className="text-xs text-red-300">
        {voice.error instanceof Error
          ? voice.error.message
          : "This voice note could not be opened."}
      </p>
    );
  }

  return (
    <figure className="min-w-0 space-y-2">
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        className="h-10 max-w-full"
        aria-label="Private voice note"
      />
      <figcaption className="whitespace-pre-wrap break-words text-sm">
        <LinkSafetyText text={payload.caption?.trim() || "Voice note"} />
      </figcaption>
    </figure>
  );
}
