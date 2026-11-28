"use client";

import type { ReplyChatPayload } from "@/lib/chat-payload";
import { LinkSafetyText } from "@/components/link-safety-text";

export function ReplyQuoteBlock({
  payload,
  fromMe,
}: {
  payload: ReplyChatPayload;
  fromMe: boolean;
}) {
  return (
    <div className="space-y-2">
      <div
        className={`space-y-1.5 rounded-2xl border px-3 py-2 ${
          fromMe
            ? "border-black/10 bg-black/[0.04]"
            : "border-white/10 bg-white/[0.04]"
        }`}
      >
        <p
          className={`text-[10px] font-semibold tracking-wide uppercase ${
            fromMe ? "text-black/45" : "text-white/45"
          }`}
        >
          Replying to {payload.refs.length} message
          {payload.refs.length === 1 ? "" : "s"}
        </p>
        {payload.refs.map((ref) => (
          <div
            key={ref.id}
            className={`rounded-xl px-2.5 py-1.5 text-xs ${
              fromMe ? "bg-black/[0.05] text-black/70" : "bg-black/20 text-white/70"
            }`}
          >
            <span className="mr-1.5 font-medium opacity-70">
              {ref.sender?.trim() || (ref.fromMe ? "You" : "Them")} ·
            </span>
            {ref.preview}
          </div>
        ))}
      </div>
      <LinkSafetyText text={payload.body} />
    </div>
  );
}
