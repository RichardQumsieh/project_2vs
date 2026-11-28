import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { mediaMessages, memberColor, memberInitials, memberLabel } from "../../frontend/lib/group-presentation";
import type { LocalMessage } from "../../frontend/lib/crypto/types";
import { api, type Conversation } from "./api";
import { NativeMessageBody } from "./message-body";
import { t } from "./i18n";
import { useColors } from "./theme";

export function GroupInfoScreen({
  conversation,
  messages,
  selfUserId,
  visible,
  onClose,
  onChanged,
  onLeave,
  onRemoveMember,
  onRenamed,
}: {
  conversation: Conversation;
  messages: readonly LocalMessage[];
  selfUserId: string | null;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  onLeave: (actor: string) => Promise<void>;
  onRemoveMember: (userId: string, label: string) => Promise<void>;
  onRenamed: (title: string) => Promise<void>;
}) {
  const colors = useColors();
  const [title, setTitle] = useState(conversation.title ?? "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [members, setMembers] = useState(conversation.members ?? []);
  useEffect(() => {
    setMembers(conversation.members ?? []);
    setTitle(conversation.title ?? "");
  }, [conversation]);
  const me = members.find((member) => member.userId === selfUserId);
  const admin = me?.role === "ADMIN";
  const media = mediaMessages(messages);
  const heading = conversation.title?.trim() || "Group";

  async function rename() {
    const next = title.trim();
    if (!next || !admin) return;
    setError("");
    try {
      await api.renameGroup(conversation.id, next);
      await onRenamed(next);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename the group.");
    }
  }

  async function add() {
    const needle = query.trim().replace(/^@/, "");
    if (needle.length < 2) return;
    setError("");
    try {
      const page = await api.searchPeople(needle);
      const person = page.users.find((user) => user.username === needle) ?? (page.users.length === 1 ? page.users[0] : null);
      if (!person) {
        setError("No person matches that name.");
        return;
      }
      await api.addGroupMember(conversation.id, person.id);
      setMembers((current) => current.some((member) => member.userId === person.id) ? current : [...current, {
        userId: person.id,
        username: person.username,
        displayName: person.displayName,
        avatarUrl: person.avatarUrl,
        role: "MEMBER" as const,
      }]);
      setQuery("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add that member.");
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={onClose} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Text style={[styles.title, { color: colors.ink }]}>{t("groupInfo")}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={[styles.avatar, { backgroundColor: memberColor(conversation.id) }]}>
              <Text style={styles.avatarText}>{memberInitials(heading)}</Text>
            </View>
            <Text style={[styles.name, { color: colors.ink }]}>{heading}</Text>
            <Text style={{ color: colors.muted }}>{members.length} members</Text>
          </View>
          {admin ? (
            <View style={styles.row}>
              <TextInput value={title} onChangeText={setTitle} placeholder={t("saveName")} style={[styles.input, { color: colors.ink, borderColor: colors.line }]} maxLength={80} />
              <Pressable accessibilityRole="button" accessibilityLabel={t("saveName")} onPress={() => void rename()} style={styles.action}>
                <Text style={styles.actionText}>{t("saveName")}</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={[styles.section, { color: colors.muted }]}>{t("members")}</Text>
          {members.map((member) => {
            const label = memberLabel(member);
            return (
              <View key={member.userId} style={styles.member}>
                <View style={[styles.smallAvatar, { backgroundColor: memberColor(member.userId) }]}>
                  <Text style={styles.avatarText}>{memberInitials(label)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontWeight: "700" }}>{label}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>@{member.username} · {member.role === "ADMIN" ? "Admin" : "Member"}</Text>
                </View>
                {admin && member.userId !== selfUserId ? (
                  <View style={styles.memberActions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={member.role === "ADMIN" ? "Member" : "Admin"} onPress={() => {
                      const next = member.role === "ADMIN" ? "MEMBER" : "ADMIN";
                      void api.setGroupMemberRole(conversation.id, member.userId, next).then(() => {
                        setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role: next } : item));
                        onChanged();
                      }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not change that role."));
                    }}>
                      <Text style={styles.actionText}>{member.role === "ADMIN" ? "Member" : "Admin"}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("removeMember")} onPress={() => void onRemoveMember(member.userId, label).then(() => {
                      setMembers((current) => current.filter((item) => item.userId !== member.userId));
                      onChanged();
                    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not remove that member."))}>
                      <Text style={styles.danger}>{t("removeMember")}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          {admin ? (
            <View style={styles.row}>
              <TextInput value={query} onChangeText={setQuery} placeholder="@username" autoCapitalize="none" style={[styles.input, { color: colors.ink, borderColor: colors.line }]} />
              <Pressable accessibilityRole="button" accessibilityLabel={t("addMember")} onPress={() => void add()} style={styles.action}>
                <Text style={styles.actionText}>{t("addMember")}</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={[styles.section, { color: colors.muted }]}>{t("media")}</Text>
          {media.length === 0 ? <Text style={{ color: colors.muted }}>{t("noMedia")}</Text> : media.map((message) => (
            <View key={message.id} style={styles.mediaCard}>
              <NativeMessageBody conversationId={conversation.id} plaintext={message.plaintext} fromMe={Boolean(message.fromMe)} />
            </View>
          ))}
          {!!error && <Text style={styles.danger}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel={t("leaveGroup")} onPress={() => void onLeave(me?.displayName?.trim() || me?.username || "A member")} style={styles.leave}>
            <Text style={styles.danger}>{t("leaveGroup")}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "700" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  hero: { alignItems: "center", gap: 6, marginBottom: 8 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  smallAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "700" },
  name: { fontSize: 20, fontWeight: "700" },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", marginTop: 8 },
  member: { flexDirection: "row", alignItems: "center", gap: 10 },
  memberActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  actionText: { color: "#6D28D9", fontWeight: "700" },
  danger: { color: "#B42318", fontWeight: "700" },
  mediaCard: { borderRadius: 12, padding: 8 },
  leave: { marginTop: 12, minHeight: 44, justifyContent: "center" },
});
