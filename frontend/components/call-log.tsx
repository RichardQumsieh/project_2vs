"use client";

import { callLogLabel, type CallChatPayload } from "@/lib/chat-payload";

export function CallLogBlock({ payload }: { payload: CallChatPayload }) {
  return (
    <p className="text-sm font-medium">
      {callLogLabel(payload)}
    </p>
  );
}
