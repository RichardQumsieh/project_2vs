import { Ionicons } from "@expo/vector-icons";
import React, { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { LocalMessage } from "../../frontend/lib/crypto/types";
import type { Conversation } from "./api";
import { deleteScopes, swipeOpenAction } from "./message-actions";
import { NativeMessageBody } from "./message-body";
import { C } from "./ui";

type Props = {
  message: LocalMessage;
  conversation: Conversation;
  pending: boolean;
  selecting: boolean;
  selected: boolean;
  onReply: (message: LocalMessage) => void;
  onToggleSelect: (message: LocalMessage) => void;
  onBeginSelect: (message: LocalMessage) => void;
  onDelete: (message: LocalMessage) => void;
};

function Action({ label, icon, tone }: { label: string; icon: keyof typeof Ionicons.glyphMap; tone: "delete" | "reply" }) {
  return (
    <View style={[styles.action, tone === "delete" ? styles.deleteAction : styles.replyAction]}>
      <Ionicons name={icon} size={16} color="#FFFFFF" />
      <Text style={styles.actionText}>{label}</Text>
    </View>
  );
}

export function SwipeableMessage({
  message,
  conversation,
  pending,
  selecting,
  selected,
  onReply,
  onToggleSelect,
  onBeginSelect,
  onDelete,
}: Props) {
  const swipeRef = useRef<SwipeableMethods>(null);
  const sender = message.fromMe
    ? "You"
    : conversation.type === "DIRECT"
      ? conversation.peer?.displayName || conversation.peer?.username || "Member"
      : conversation.members?.find((member) => member.userId === message.senderUserId)?.displayName
        || conversation.members?.find((member) => member.userId === message.senderUserId)?.username
        || "Member";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt));
  const everyone = deleteScopes({ fromMe: Boolean(message.fromMe), pending }).includes("everyone");

  return (
    <Swipeable
      ref={swipeRef}
      enabled={!selecting}
      overshootLeft={false}
      overshootRight={false}
      leftThreshold={72}
      rightThreshold={72}
      renderLeftActions={() => <Action label={everyone ? "Delete" : "Delete for me"} icon="trash" tone="delete" />}
      renderRightActions={() => <Action label="Reply" icon="return-up-back" tone="reply" />}
      onSwipeableOpen={(direction) => {
        swipeRef.current?.close();
        const action = swipeOpenAction(direction);
        if (action === "delete") onDelete(message);
        else onReply(message);
      }}
    >
      <Pressable
        accessibilityRole={selecting ? "checkbox" : "button"}
        accessibilityState={selecting ? { checked: selected } : undefined}
        accessibilityHint={selecting ? "Include this message in the reply" : "Swipe left to reply. Swipe right to delete. Long press to select more."}
        onLongPress={() => onBeginSelect(message)}
        onPress={() => { if (selecting) onToggleSelect(message); }}
        delayLongPress={320}
        style={[styles.messageRow, message.fromMe ? styles.messageRowMine : styles.messageRowPeer]}
      >
        {selecting ? <View style={[styles.checkbox, selected && styles.checkboxOn]} /> : null}
        <View style={[styles.messageBubble, message.fromMe ? styles.messageBubbleMine : styles.messageBubblePeer, selected && styles.selected]}>
          {conversation.type === "GROUP" && !message.fromMe ? <Text style={styles.senderName}>{sender}</Text> : null}
          <NativeMessageBody conversationId={conversation.id} plaintext={message.plaintext} fromMe={message.fromMe} />
          <View style={styles.messageMeta}>
            <Text style={[styles.messageTime, message.fromMe && styles.messageTimeMine]}>{pending ? "Waiting to send" : time}</Text>
            {message.fromMe && !pending ? <Ionicons name="checkmark-done" size={13} color="#DCD2ED" /> : null}
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: { width: 92, marginBottom: 9, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 4 },
  deleteAction: { backgroundColor: "#B42318" },
  replyAction: { backgroundColor: C.purple },
  actionText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  messageRow: { width: "100%", marginBottom: 9, flexDirection: "row", alignItems: "flex-end", gap: 8 },
  messageRowMine: { justifyContent: "flex-end" },
  messageRowPeer: { justifyContent: "flex-start" },
  checkbox: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.paper, marginBottom: 10 },
  checkboxOn: { backgroundColor: C.purple, borderColor: C.purple },
  messageBubble: { maxWidth: "84%", minWidth: 84, borderRadius: 19, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 7 },
  messageBubbleMine: { backgroundColor: C.purple, borderBottomEndRadius: 6 },
  messageBubblePeer: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderBottomStartRadius: 6 },
  selected: { borderWidth: 2, borderColor: "#C4B5FD" },
  senderName: { color: C.purple, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  messageMeta: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 4 },
  messageTime: { color: C.faint, fontSize: 10 },
  messageTimeMine: { color: "#DDD5EB" },
});
