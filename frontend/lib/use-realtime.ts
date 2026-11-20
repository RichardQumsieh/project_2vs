"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { wsUrl } from "./api";
import {
  applyRemoteMessageDeletion,
  decryptIncoming,
} from "./session";
import type { WireMessage } from "./crypto/types";

export function useRealtime(unlocked: boolean, userId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!unlocked) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl());
      socket.onmessage = async (event) => {
        const payload = JSON.parse(event.data) as
          | { type: "hello" }
          | { type: "message"; conversationId: string; message: WireMessage }
          | {
              type: "message_deleted";
              conversationId: string;
              logicalMessageId: string;
              messageRecordIds: string[];
            }
          | { type: "group_mls"; conversationId: string };
        if (payload.type === "message_deleted") {
          await applyRemoteMessageDeletion(
            payload.conversationId,
            payload.logicalMessageId,
            payload.messageRecordIds,
          );
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["conversations", userId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["wire-messages", userId, payload.conversationId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["local-messages", userId, payload.conversationId],
            }),
          ]);
          return;
        }
        if (payload.type === "group_mls") {
          await queryClient.invalidateQueries({
            queryKey: ["group-sync", payload.conversationId],
          });
          return;
        }
        if (payload.type !== "message") return;
        try {
          await decryptIncoming(payload.message);
        } catch (error) {
          console.warn("Could not decrypt realtime message", payload.message.id, error);
        }
        await queryClient.invalidateQueries({
          queryKey: ["conversations", userId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["wire-messages", userId, payload.conversationId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["local-messages", userId, payload.conversationId],
        });
      };
      socket.onclose = (event) => {
        if (event.code === 4401 || event.code === 4403) {
          stopped = true;
          if (event.code === 4401) {
            void queryClient.invalidateQueries({ queryKey: ["me"] });
          }
          return;
        }
        if (!stopped) retryTimer = setTimeout(connect, 1000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [queryClient, unlocked, userId]);
}
