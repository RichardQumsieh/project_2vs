"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { VideoChatPayload } from "@/lib/chat-payload";
import {
  decryptVideoBytes,
  maxEncryptedVideoBytes,
} from "@/lib/crypto/video";
import { LinkSafetyText } from "@/components/link-safety-text";

export function EncryptedVideo({
  conversationId,
  payload,
}: {
  conversationId: string;
  payload: VideoChatPayload;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = useQuery({
    queryKey: ["encrypted-video", conversationId, payload.id],
    queryFn: async () => {
      const { downloadUrl } = await api.mediaDownload(conversationId, payload.id);
      const response = await fetch(downloadUrl, { cache: "no-store", redirect: "error" });
      if (!response.ok) {
        throw new Error("The video could not be downloaded.");
      }
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        (!/^\d+$/.test(contentLength) ||
          Number(contentLength) !== payload.bytes ||
          Number(contentLength) > maxEncryptedVideoBytes)
      ) {
        throw new Error("The downloaded video has an invalid size.");
      }
      const ciphertext = new Uint8Array(await response.arrayBuffer());
      if (
        ciphertext.byteLength !== payload.bytes ||
        ciphertext.byteLength > maxEncryptedVideoBytes
      ) {
        throw new Error("The downloaded video has an invalid size.");
      }
      return decryptVideoBytes(ciphertext, payload.k, payload.n, payload.mime);
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    const element = videoRef.current;
    if (!video.data || !element) return;
    const url = URL.createObjectURL(video.data);
    element.src = url;
    return () => {
      element.pause();
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [video.data]);

  if (video.isPending) {
    return <p className="text-xs text-white/50">Loading video…</p>;
  }
  if (video.isError || !video.data) {
    return (
      <p className="text-xs text-red-300">
        {video.error instanceof Error
          ? video.error.message
          : "This video could not be opened."}
      </p>
    );
  }

  return (
    <figure className="min-w-0 space-y-2">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        className="max-h-[min(60dvh,28rem)] w-full rounded-2xl bg-black object-contain"
        aria-label={payload.caption?.trim() || "Private video"}
      />
      {payload.caption?.trim() ? (
        <figcaption className="text-sm">
          <LinkSafetyText text={payload.caption} />
        </figcaption>
      ) : null}
    </figure>
  );
}
