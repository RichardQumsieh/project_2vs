import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef } from "react";
import { I18nManager, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { memberColor } from "../../frontend/lib/group-presentation";
import { PersonBadge } from "./person-badge";
import type { LocalMessage } from "../../frontend/lib/crypto/types";
import type { Conversation } from "./api";
import { t } from "./i18n";
import { clusterSpacing, type MessageCluster } from "./thread-rows";
import { NativeMessageBody } from "./message-body";
import { swipeIntent } from "./message-actions";
import { useColors } from "./theme";

const ACTION = 84;
const THRESHOLD = 72;

const closers = new Set<() => void>();

function closeOtherRows(current: () => void) {
  closers.forEach((close) => {
    if (close !== current) close();
  });
}

type Props = {
  message: LocalMessage;
  conversation: Conversation;
  pending: boolean;
  selecting: boolean;
  selected: boolean;
  cluster: MessageCluster;
  showSender: boolean;
  onReply: (message: LocalMessage) => void;
  onToggleSelect: (message: LocalMessage) => void;
  onOpenMenu: (message: LocalMessage) => void;
  onDelete: (message: LocalMessage) => void;
  readLabel?: string | null;
  onRetry?: () => void;
};

function senderName(message: LocalMessage, conversation: Conversation) {
  if (message.fromMe) return "You";
  if (conversation.type === "DIRECT") {
    return conversation.peer?.displayName || conversation.peer?.username || "Member";
  }
  return conversation.members?.find((member) => member.userId === message.senderUserId)?.displayName
    || conversation.members?.find((member) => member.userId === message.senderUserId)?.username
    || "Member";
}

export function SwipeableMessage({
  message,
  conversation,
  pending,
  selecting,
  selected,
  cluster,
  showSender,
  onReply,
  onToggleSelect,
  onOpenMenu,
  onDelete,
  readLabel,
  onRetry,
}: Props) {
  const colors = useColors();
  const tx = useSharedValue(0);
  const tripped = useRef(false);
  const rtl = I18nManager.isRTL;
  const handlers = useRef({ onReply, onDelete, onOpenMenu, onToggleSelect });
  handlers.current = { onReply, onDelete, onOpenMenu, onToggleSelect };

  const close = useMemo(() => () => {
    tx.value = withTiming(0, { duration: 160 });
  }, [tx]);

  useEffect(() => {
    closers.add(close);
    return () => {
      closers.delete(close);
    };
  }, [close]);

  const gesture = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .enabled(!selecting)
    .activeOffsetX([-18, 18])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      tripped.current = false;
      closeOtherRows(close);
    })
    .onUpdate((event) => {
      const signed = rtl ? -event.translationX : event.translationX;
      const next = Math.max(-ACTION, Math.min(ACTION, signed));
      tx.value = next;
      if (!tripped.current && Math.abs(next) >= THRESHOLD) {
        tripped.current = true;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      }
    })
    .onFinalize((event) => {
      const signed = rtl ? -event.translationX : event.translationX;
      const action = swipeIntent(signed, THRESHOLD);
      tx.value = withTiming(0, { duration: 180 });
      if (action === "delete") handlers.current.onDelete(message);
      else if (action === "reply") handlers.current.onReply(message);
    }), [close, message, rtl, selecting, tx]);

  const leadingStyle = useAnimatedStyle(() => ({
    width: Math.max(0, tx.value),
    opacity: tx.value > 1 ? 1 : 0,
  }));
  const trailingStyle = useAnimatedStyle(() => ({
    width: Math.max(0, -tx.value),
    opacity: tx.value < -1 ? 1 : 0,
  }));
  const travelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: rtl ? -tx.value : tx.value }],
  }));

  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt));
  const tail = cluster === "single" || cluster === "last";
  const mine = Boolean(message.fromMe);
  const name = senderName(message, conversation);
  const color = memberColor(message.senderUserId || message.senderDeviceId || message.id);
  const group = conversation.type === "GROUP";

  return (
    <View
      collapsable={false}
      style={[styles.clip, { marginBottom: clusterSpacing(cluster), backgroundColor: colors.bg }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.reveal, rtl ? styles.revealEnd : styles.revealStart, { backgroundColor: "#B42318" }, leadingStyle]}
      >
        <View style={styles.action}>
          <Ionicons name="trash" size={18} color="#FFFFFF" />
          <Text style={styles.actionText}>{t("delete")}</Text>
        </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.reveal, rtl ? styles.revealStart : styles.revealEnd, { backgroundColor: colors.purpleDark }, trailingStyle]}
      >
        <View style={styles.action}>
          <Ionicons name="return-up-back" size={18} color="#FFFFFF" />
          <Text style={styles.actionText}>{t("reply")}</Text>
        </View>
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.foreground, { backgroundColor: colors.bg }, travelStyle]}>
          <Pressable
            accessibilityRole={selecting ? "checkbox" : "button"}
            accessibilityState={selecting ? { checked: selected } : undefined}
            accessibilityHint="Swipe to reply or delete. Long press for more actions."
            delayLongPress={320}
            onLongPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              handlers.current.onOpenMenu(message);
            }}
            onPress={() => {
              if (selecting) handlers.current.onToggleSelect(message);
            }}
            style={[styles.line, mine ? styles.lineMine : styles.linePeer]}
          >
            {selecting ? <View style={[styles.checkbox, { borderColor: colors.line, backgroundColor: colors.paper }, selected && { backgroundColor: colors.purple, borderColor: colors.purple }]} /> : null}
            {!mine && (group || conversation.type === "DIRECT") ? (
              showSender ? (
                <PersonBadge
                  person={conversation.type === "DIRECT"
                    ? conversation.peer
                    : conversation.members?.find((member) => member.userId === message.senderUserId)}
                  title={name}
                  size={28}
                />
              ) : <View style={styles.avatarSpacer} />
            ) : null}
            <View
              style={[
                styles.bubble,
                mine ? { backgroundColor: colors.mine } : { backgroundColor: colors.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
                tail && mine && styles.tailMine,
                tail && !mine && styles.tailPeer,
                selected && { borderWidth: 2, borderColor: colors.lilac2 },
              ]}
            >
              {showSender && group ? <Text style={[styles.sender, { color }]}>{name}</Text> : null}
              <NativeMessageBody conversationId={conversation.id} plaintext={message.plaintext} fromMe={mine} onRetry={onRetry} />
              <View style={styles.meta}>
                <Text style={[styles.time, { color: mine ? "#DDD5EB" : colors.faint }]}>{pending ? "…" : time}</Text>
                {mine && !pending && !group ? <Ionicons name="checkmark-done" size={13} color="#DCD2ED" /> : null}
                {mine && !pending && group ? <Ionicons name="checkmark" size={13} color="#DCD2ED" accessibilityLabel={t("sent")} /> : null}
                {readLabel ? <Text style={[styles.time, { color: mine ? "#DDD5EB" : colors.faint }]}>{readLabel}</Text> : null}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { width: "100%", overflow: "hidden" },
  reveal: { position: "absolute", top: 0, bottom: 0, width: 0, opacity: 0, overflow: "hidden", justifyContent: "center" },
  revealStart: { left: 0 },
  revealEnd: { right: 0 },
  action: { width: ACTION, flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  actionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  foreground: { width: "100%" },
  line: { width: "100%", flexDirection: "row", alignItems: "flex-end", gap: 8 },
  lineMine: { justifyContent: "flex-end" },
  linePeer: { justifyContent: "flex-start" },
  checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, marginBottom: 8 },
  bubble: { maxWidth: "78%", minWidth: 72, borderRadius: 18, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  tailMine: { borderBottomEndRadius: 6 },
  tailPeer: { borderBottomStartRadius: 6 },
  sender: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  avatarSpacer: { width: 28 },
  avatarText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  meta: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 3 },
  time: { fontSize: 11 },
});
