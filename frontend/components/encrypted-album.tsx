"use client";

import type { AlbumChatPayload } from "@/lib/chat-payload";
import { EncryptedPhoto } from "@/components/encrypted-photo";
import { LinkSafetyText } from "@/components/link-safety-text";

export function EncryptedAlbum({
  conversationId,
  payload,
  fromMe,
}: {
  conversationId: string;
  payload: AlbumChatPayload;
  fromMe: boolean;
}) {
  const count = payload.items.length;
  const gridClass =
    count === 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-2"
        : "grid-cols-2 sm:grid-cols-3";

  return (
    <figure className="space-y-2">
      <div className={`grid gap-1.5 ${gridClass}`}>
        {payload.items.map((item) => (
          <EncryptedPhoto
            key={item.id}
            conversationId={conversationId}
            payload={{ ...item, type: "image" }}
            fromMe={fromMe}
            className="aspect-square max-h-none w-full rounded-xl object-cover"
          />
        ))}
      </div>
      {payload.caption?.trim() ? (
        <figcaption className="text-sm">
          <LinkSafetyText text={payload.caption} />
        </figcaption>
      ) : (
        <p className={`text-[11px] ${fromMe ? "text-black/45" : "text-white/40"}`}>
          {count} photo{count === 1 ? "" : "s"}
        </p>
      )}
    </figure>
  );
}
