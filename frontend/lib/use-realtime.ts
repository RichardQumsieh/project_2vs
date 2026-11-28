"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { wsUrl, type Conversation } from "./api";
import { groupAlertDecision } from "./group-alerts";
import { attachTypingSocket, noteGroupTyping } from "./group-typing-client";
import { useI18n } from "./i18n/locale";
import {
  applyRemoteMessageDeletion,
  decryptIncoming,
} from "./session";
import type { WireMessage } from "./crypto/types";

export function useRealtime(unlocked: boolean, userId: string | null) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { t } = useI18n();
  const activeConversationId = pathname.match(/^\/inbox\/([^/]+)/)?.[1] ?? null;
  const alertRef = useRef({ activeConversationId, t });
  alertRef.current = { activeConversationId, t };

  useEffect(() => {
    if (!unlocked) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl());
      attachTypingSocket(socket);
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
          | { type: "group_mls"; conversationId: string; kind?: string }
          | { type: "group_typing"; conversationId: string; userId: string };
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
        if (payload.type === "group_typing") {
          if (payload.userId && payload.conversationId) {
            noteGroupTyping({ conversationId: payload.conversationId, userId: payload.userId });
          }
          return;
        }
        if (payload.type === "group_mls") {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["group-sync", payload.conversationId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["conversations", userId],
            }),
          ]);
          const conversations = queryClient.getQueryData<Conversation[]>(["conversations", userId]);
          const title = conversations?.find((item) => item.id === payload.conversationId)?.title?.trim()
            || alertRef.current.t("group.fallbackTitle");
          if (
            groupAlertDecision({
              kind: payload.kind,
              conversationId: payload.conversationId,
              activeConversationId: alertRef.current.activeConversationId,
              pageVisible: document.visibilityState === "visible",
            }) &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            new Notification(alertRef.current.t("group.notifyTitle"), {
              body: alertRef.current.t("group.notifyBody", { title }),
              tag: payload.conversationId,
            });
          }
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
      attachTypingSocket(null);
      socket?.close();
    };
  }, [queryClient, unlocked, userId]);
}
