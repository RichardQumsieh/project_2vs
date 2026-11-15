"use client";

import { useState } from "react";
import type { LocationChatPayload } from "@/lib/chat-payload";
import {
  buildExternalMapsUrl,
  describeLocationAccuracy,
  formatCoordinate,
} from "@/lib/location-share";

export function EncryptedLocation({
  payload,
  fromMe,
}: {
  payload: LocationChatPayload;
  fromMe: boolean;
}) {
  const [mapsNotice, setMapsNotice] = useState<string | null>(null);
  const accuracy = describeLocationAccuracy(payload.accuracy);
  const mapsUrl = buildExternalMapsUrl(payload.lat, payload.lon);

  return (
    <div className="space-y-2">
      <div
        className={`overflow-hidden rounded-2xl border ${
          fromMe ? "border-black/10 bg-black/[0.04]" : "border-white/10 bg-black/25"
        }`}
      >
        <div
          className="relative h-28 w-full bg-[radial-gradient(circle_at_50%_58%,rgba(56,189,248,0.35),transparent_28%),linear-gradient(160deg,#102033,#0b1220_55%,#152033)]"
          aria-hidden="true"
        >
          <span className="absolute left-1/2 top-[58%] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_0_6px_rgba(56,189,248,0.25)]" />
          <span className="absolute inset-x-6 top-3 text-[10px] tracking-[0.16em] text-cyan-100/70 uppercase">
            End-to-end encrypted location
          </span>
        </div>
        <div className="space-y-1.5 p-3">
          <p className={`text-sm font-medium ${fromMe ? "text-black" : "text-white"}`}>
            {payload.name?.trim() || "Shared location"}
          </p>
          <p className={`font-mono text-xs ${fromMe ? "text-black/65" : "text-white/65"}`}>
            {formatCoordinate(payload.lat)}, {formatCoordinate(payload.lon)}
          </p>
          {accuracy ? (
            <p className={`text-[11px] ${fromMe ? "text-black/50" : "text-white/45"}`}>
              {accuracy}
            </p>
          ) : null}
          <p className={`text-[11px] ${fromMe ? "text-black/45" : "text-white/40"}`}>
            Coordinates stay inside the encrypted message. Opening a map sends them to that map
            provider.
          </p>
          <button
            type="button"
            className={`text-xs underline underline-offset-2 ${
              fromMe ? "text-black/70" : "text-cyan-100/80"
            }`}
            onClick={() => {
              const confirmed = window.confirm(
                "Open this location in OpenStreetMap? Your coordinates will be sent to that site.",
              );
              if (!confirmed) {
                setMapsNotice("Map open cancelled. Coordinates remain only in this chat.");
                return;
              }
              setMapsNotice(null);
              window.open(mapsUrl, "_blank", "noopener,noreferrer");
            }}
          >
            Open in OpenStreetMap
          </button>
          {mapsNotice ? (
            <p role="status" className={`text-[11px] ${fromMe ? "text-black/50" : "text-white/45"}`}>
              {mapsNotice}
            </p>
          ) : null}
        </div>
      </div>
      {payload.caption?.trim() ? (
        <p className={`whitespace-pre-wrap text-sm ${fromMe ? "text-black/80" : "text-white/85"}`}>
          {payload.caption.trim()}
        </p>
      ) : null}
    </div>
  );
}
