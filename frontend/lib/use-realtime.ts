"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { wsUrl, type Conversation } from "./api";
import { bumpDmUnread, loadDmUnread, saveDmUnread } from "./dm-unread";
import { groupAlertDecision, messageAlertDecision } from "./message-alerts";
import { useI18n } from "./i18n/locale";
import { setRealtimeSocket } from "./realtime-socket";
import {
  applyRemoteMessageDeletion,
  currentDeviceId,
  decryptIncoming,
} from "./session";
import type { WireMessage } from "./crypto/types";
import { notePeerRead, noteRemoteTyping } from "./typing-state";

export function useRealtime(unlocked: boolean, userId: string | null) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { t } = useI18n();
  const activeConversationId = pathname.match(/^\/inbox\/([^/]+)/)?.[1] ?? null;
  const alertRef = useRef({ activeConversationId, t, userId });
  alertRef.current = { activeConversationId, t, userId };

  useEffect(() => {
    if (!unlocked) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl());
      setRealtimeSocket(socket);
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
          | { type: "typing"; conversationId: string; userId: string }
          | { type: "read"; conversationId: string; userId: string; at: string };
        if (payload.type === "typing") {
          if (payload.userId && payload.conversationId) {
            noteRemoteTyping(payload.conversationId, payload.userId);
          }
          return;
        }
        if (payload.type === "read") {
          if (payload.userId && payload.conversationId && payload.at) {
            notePeerRead(payload.conversationId, payload.at, payload.userId);
          }
          return;
        }
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

        const viewerId = alertRef.current.userId;
        let deviceId: string | null = null;
        try {
          deviceId = currentDeviceId();
        } catch {
          deviceId = null;
        }
        const fromSelf =
          Boolean(viewerId) &&
          (payload.message.senderUserId === viewerId ||
            (Boolean(deviceId) && payload.message.senderDeviceId === deviceId));
        const conversations = queryClient.getQueryData<Conversation[]>(["conversations", userId]);
        const conversation = conversations?.find((item) => item.id === payload.conversationId);
        const shouldAlert = messageAlertDecision({
          conversationId: payload.conversationId,
          activeConversationId: alertRef.current.activeConversationId,
          pageVisible: document.visibilityState === "visible",
        });
        if (viewerId && shouldAlert && !fromSelf) {
          if (!conversation || conversation.type === "DIRECT") {
            const map = bumpDmUnread(loadDmUnread(viewerId), payload.conversationId);
            saveDmUnread(viewerId, map);
            window.dispatchEvent(new CustomEvent("sophia-dm-unread"));
          }
          const title =
            conversation?.type === "GROUP"
              ? conversation.title?.trim() || alertRef.current.t("group.fallbackTitle")
              : conversation?.peer?.displayName ||
                conversation?.peer?.username ||
                alertRef.current.t("inbox.unknown");
          if (
            conversation?.type !== "GROUP" &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            new Notification(alertRef.current.t("chat.notifyTitle"), {
              body: alertRef.current.t("chat.notifyBody", { title }),
              tag: payload.conversationId,
            });
          }
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
        if (socket) setRealtimeSocket(null);
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
      setRealtimeSocket(null);
      socket?.close();
    };
  }, [queryClient, unlocked, userId]);
}
