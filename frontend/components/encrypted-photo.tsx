"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ImageChatPayload } from "@/lib/chat-payload";
import { decryptPhotoBytes } from "@/lib/crypto/media";
import { LinkSafetyText } from "@/components/link-safety-text";
import { PhotoLightbox } from "@/components/photo-lightbox";

export function EncryptedPhoto({
  conversationId,
  payload,
  fromMe,
  className = "max-h-80 w-full rounded-2xl object-cover",
}: {
  conversationId: string;
  payload: ImageChatPayload;
  fromMe: boolean;
  className?: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const photo = useQuery({
    queryKey: ["encrypted-photo", conversationId, payload.id],
    queryFn: async () => {
      const { downloadUrl } = await api.mediaDownload(conversationId, payload.id);
      const response = await fetch(downloadUrl, { cache: "no-store", redirect: "error" });
      if (!response.ok) {
        throw new Error("The photo could not be downloaded.");
      }
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        (!/^\d+$/.test(contentLength) ||
          Number(contentLength) !== payload.bytes ||
          Number(contentLength) > 6_500_000)
      ) {
        throw new Error("The downloaded photo has an invalid size.");
      }
      const ciphertext = new Uint8Array(await response.arrayBuffer());
      if (ciphertext.byteLength !== payload.bytes || ciphertext.byteLength > 6_500_000) {
        throw new Error("The downloaded photo has an invalid size.");
      }
      return decryptPhotoBytes(ciphertext, payload.k, payload.n, payload.mime);
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    const image = imageRef.current;
    if (!photo.data || !image) return;
    const url = URL.createObjectURL(photo.data);
    image.src = url;
    setObjectUrl(url);
    return () => {
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [photo.data]);

  if (photo.isPending) {
    return (
      <p className={`text-xs ${fromMe ? "text-black/50" : "text-white/50"}`}>
        Loading photo…
      </p>
    );
  }

  if (photo.isError || !photo.data) {
    return (
      <p className={`text-xs ${fromMe ? "text-red-700" : "text-red-300"}`}>
        {photo.error instanceof Error ? photo.error.message : "This photo could not be opened."}
      </p>
    );
  }

  return (
    <figure className="space-y-2">
      <button
        type="button"
        className="block w-full overflow-hidden rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/60"
        aria-label="Open photo"
        onClick={() => setLightboxOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          alt={payload.caption?.trim() || "Photo"}
          width={payload.w}
          height={payload.h}
          className={`${className} cursor-zoom-in transition duration-200 hover:brightness-110`}
        />
      </button>
      {payload.caption?.trim() ? (
        <figcaption className="text-sm">
          <LinkSafetyText text={payload.caption} />
        </figcaption>
      ) : null}
      <PhotoLightbox
        open={lightboxOpen}
        src={objectUrl}
        alt={payload.caption?.trim() || "Photo"}
        onClose={() => setLightboxOpen(false)}
      />
    </figure>
  );
}
