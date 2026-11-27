import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  encodeReplyPayload,
  maxAlbumPhotos,
  maxReplyRefs,
  messagePreviewText,
} from "../../frontend/lib/chat-payload";
import { maxPhotoBytes } from "../../frontend/lib/crypto/media";
import { maxFileAttachmentBytes, sanitizeAttachmentName } from "../../frontend/lib/crypto/file-attachment";
import { maxVideoDurationSeconds, maxEncryptedVideoBytes } from "../../frontend/lib/crypto/video";
import type { LocalMessage } from "../../frontend/lib/crypto/types";
import type { EncryptedFileAttachment } from "../../frontend/lib/crypto/file-attachment";
import { readUriBytes } from "./media-io";
import { NativePhotoEditor } from "./photo-editor";
import {
  prepareNativeChatMediaPlaintext,
  prepareNativeFileAttachment,
  type NativeMediaAsset,
} from "./prepare-chat-media";
import { assertOutgoingLinksSafe } from "./url-safety";
import { NativeVoiceRecorder } from "./voice-recorder";
import { C } from "./ui";

const COMPOSER_EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😉",
  "😊", "😍", "🥰", "😘", "😎", "🤔", "🥺", "😭",
  "😢", "😴", "🙌", "👏", "🙏", "👍", "👎", "🤝",
  "❤️", "💛", "💚", "💙", "💜", "🔥", "🎉", "✨",
  "💯", "🌹", "☕", "🌙", "✅", "🤍", "💪", "🫶",
];

type Props = {
  conversationId: string;
  joined: boolean;
  messages: readonly LocalMessage[];
  disabled: boolean;
  placeholder: string;
  onSendPlaintext: (plaintext: string) => Promise<void>;
};

export function NativeMediaComposer({
  conversationId,
  joined,
  messages,
  disabled,
  placeholder,
  onSendPlaintext,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [photos, setPhotos] = useState<NativeMediaAsset[]>([]);
  const [video, setVideo] = useState<NativeMediaAsset | null>(null);
  const [voice, setVoice] = useState<{ asset: NativeMediaAsset; duration: number } | null>(null);
  const [file, setFile] = useState<EncryptedFileAttachment | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [preparingFile, setPreparingFile] = useState(false);
  const [replySelectMode, setReplySelectMode] = useState(false);
  const [selectedReplyIds, setSelectedReplyIds] = useState<string[]>([]);

  const busy = disabled || sending || recording || preparingFile || !joined;
  const hasAttachment = photos.length > 0 || Boolean(video || voice || file);
  const canSend = hasAttachment || draft.trim().length > 0 || selectedReplyIds.length > 0;

  const replyPreview = useMemo(
    () =>
      selectedReplyIds
        .map((id) => messages.find((message) => message.id === id))
        .filter((message): message is LocalMessage => Boolean(message)),
    [messages, selectedReplyIds],
  );

  function clearAttachments() {
    setPhotos([]);
    setVideo(null);
    setVoice(null);
    setFile(null);
    setEditorOpen(false);
  }

  function insertEmoji(emoji: string) {
    setDraft((current) => `${current}${emoji}`);
    setEmojiOpen(false);
  }

  function toggleReply(messageId: string) {
    setSelectedReplyIds((current) => {
      if (current.includes(messageId)) return current.filter((id) => id !== messageId);
      if (current.length >= maxReplyRefs) return current;
      return [...current, messageId];
    });
  }

  async function pickPhotos() {
    setMenuOpen(false);
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library permission is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: maxAlbumPhotos,
      quality: 0.92,
    });
    if (result.canceled || !result.assets.length) return;
    try {
      const assets: NativeMediaAsset[] = [];
      for (const item of result.assets.slice(0, maxAlbumPhotos)) {
        const bytes = await readUriBytes(item.uri);
        if (bytes.byteLength > maxPhotoBytes) {
          throw new Error("Each photo must be 6 MB or smaller.");
        }
        assets.push({
          uri: item.uri,
          bytes,
          mime: item.mimeType || "image/jpeg",
          fileName: item.fileName || "photo.jpg",
          width: item.width,
          height: item.height,
        });
      }
      clearAttachments();
      setPhotos(assets);
      setEditorOpen(assets.length === 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the selected photos.");
    }
  }

  async function pickVideo() {
    setMenuOpen(false);
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Media library permission is required for videos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: false,
      videoMaxDuration: maxVideoDurationSeconds,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    try {
      const item = result.assets[0];
      const bytes = await readUriBytes(item.uri);
      const duration = (item.duration ?? 0) > 1000 ? (item.duration ?? 0) / 1000 : (item.duration ?? 0);
      if (!duration || duration > maxVideoDurationSeconds) {
        throw new Error(`Videos must be ${maxVideoDurationSeconds} seconds or shorter.`);
      }
      if (bytes.byteLength + 16 > maxEncryptedVideoBytes) {
        throw new Error("This video is too large to send encrypted. Try a shorter clip.");
      }
      clearAttachments();
      setVideo({
        uri: item.uri,
        bytes,
        mime: item.mimeType || "video/mp4",
        fileName: item.fileName || "video.mp4",
        duration,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the selected video.");
    }
  }

  async function pickDocument() {
    setMenuOpen(false);
    setError("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: [
          "application/pdf",
          "text/plain",
          "text/csv",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
      });
      if (result.canceled || !result.assets[0]) return;
      const item = result.assets[0];
      if (!item.size || item.size > maxFileAttachmentBytes) {
        throw new Error("Files must be non-empty and 450 MB or smaller.");
      }
      sanitizeAttachmentName(item.name);
      setPreparingFile(true);
      clearAttachments();
      const bytes = await readUriBytes(item.uri);
      const encrypted = await prepareNativeFileAttachment(bytes, item.name);
      setFile(encrypted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The selected file could not be verified.");
    } finally {
      setPreparingFile(false);
    }
  }

  async function submit() {
    if (busy || !canSend) return;
    setSending(true);
    setError("");
    try {
      let plaintext: string;
      const caption = draft.trim();
      if (photos.length > 1) {
        plaintext = await prepareNativeChatMediaPlaintext(conversationId, {
          kind: "album",
          assets: photos,
          caption,
        });
      } else if (photos.length === 1 && photos[0]) {
        plaintext = await prepareNativeChatMediaPlaintext(conversationId, {
          kind: "photo",
          asset: photos[0],
          caption,
        });
      } else if (video) {
        plaintext = await prepareNativeChatMediaPlaintext(conversationId, {
          kind: "video",
          asset: video,
          caption,
        });
      } else if (voice) {
        plaintext = await prepareNativeChatMediaPlaintext(conversationId, {
          kind: "voice",
          asset: voice.asset,
          duration: voice.duration,
          caption,
        });
      } else if (file) {
        plaintext = await prepareNativeChatMediaPlaintext(conversationId, {
          kind: "file",
          attachment: file,
          caption,
        });
      } else if (selectedReplyIds.length > 0) {
        if (!caption) throw new Error("Write a reply before sending.");
        await assertOutgoingLinksSafe(caption);
        const refs = replyPreview.slice(0, maxReplyRefs).map((message) => ({
          id: message.logicalMessageId ?? message.id,
          preview: messagePreviewText(message.plaintext),
          fromMe: message.fromMe,
        }));
        if (!refs.length) throw new Error("Select at least one message to reply to.");
        plaintext = encodeReplyPayload({ refs, body: caption });
      } else {
        if (!caption) return;
        await assertOutgoingLinksSafe(caption);
        plaintext = caption;
      }
      await onSendPlaintext(plaintext);
      setDraft("");
      clearAttachments();
      setSelectedReplyIds([]);
      setReplySelectMode(false);
      setMenuOpen(false);
      setEmojiOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={replySelectMode ? "Cancel reply selection" : "Reply to messages"}
          disabled={!joined}
          onPress={() => {
            if (replySelectMode) setSelectedReplyIds([]);
            setReplySelectMode((open) => !open);
          }}
          style={[styles.chip, replySelectMode && styles.chipActive]}
        >
          <Text style={[styles.chipText, replySelectMode && styles.chipTextActive]}>
            {replySelectMode ? "Cancel reply" : "Reply"}
          </Text>
        </Pressable>
        {selectedReplyIds.length > 0 ? (
          <Text style={styles.replyCount}>
            {selectedReplyIds.length} selected
          </Text>
        ) : null}
      </View>

      {(replySelectMode || selectedReplyIds.length > 0) && (
        <View style={styles.replyBanner}>
          <Text style={styles.replyBannerText}>
            {selectedReplyIds.length
              ? `${selectedReplyIds.length} message${selectedReplyIds.length === 1 ? "" : "s"} selected for one reply`
              : "Tap Include on messages to answer several at once"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear reply selection"
            onPress={() => {
              setSelectedReplyIds([]);
              setReplySelectMode(false);
            }}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        </View>
      )}

      {hasAttachment ? (
        <View style={styles.attachmentCard}>
          {photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {photos.map((photo) => (
                <Image key={photo.uri} source={{ uri: photo.uri }} style={styles.thumb} />
              ))}
            </ScrollView>
          ) : video ? (
            <Text style={styles.attachmentLabel} numberOfLines={1}>{video.fileName || "Video"} · {Math.round(video.duration || 0)}s</Text>
          ) : voice ? (
            <Text style={styles.attachmentLabel}>Voice note · {Math.floor(voice.duration)}s</Text>
          ) : file ? (
            <Text style={styles.attachmentLabel} numberOfLines={1}>{file.name}</Text>
          ) : null}
          {photos.length === 1 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Edit photo" disabled={busy} onPress={() => setEditorOpen(true)} style={styles.editBtn}>
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Remove attachment" disabled={busy} onPress={clearAttachments} style={styles.removeBtn}>
            <Ionicons name="close" size={16} color={C.muted} />
          </Pressable>
        </View>
      ) : null}

      {emojiOpen ? (
        <View style={styles.emojiPanel} accessibilityLabel="Choose an emoji">
          {COMPOSER_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${emoji}`}
              onPress={() => insertEmoji(emoji)}
              style={styles.emojiBtn}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {menuOpen ? (
        <View style={styles.menu} accessibilityLabel="Choose attachment type">
          <Pressable accessibilityRole="button" onPress={() => void pickPhotos()} style={styles.menuItem}>
            <Text style={styles.menuText}>Photos (1–{maxAlbumPhotos}, with editor)</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void pickVideo()} style={styles.menuItem}>
            <Text style={styles.menuText}>Video (up to {maxVideoDurationSeconds}s)</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void pickDocument()} style={styles.menuItem}>
            <Text style={styles.menuText}>Document (up to 450 MB)</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach photo, video, or document"
          disabled={busy || hasAttachment}
          onPress={() => {
            setEmojiOpen(false);
            setMenuOpen((open) => !open);
          }}
          style={[styles.iconBtn, (busy || hasAttachment) && styles.disabled]}
        >
          <Ionicons name="attach" size={20} color={C.muted} />
        </Pressable>
        <NativeVoiceRecorder
          disabled={busy || hasAttachment}
          onRecorded={(note) => {
            clearAttachments();
            setVoice(note);
          }}
          onError={setError}
          onRecordingChange={setRecording}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={emojiOpen ? "Close emoji picker" : "Open emoji picker"}
          disabled={!joined || sending}
          onPress={() => {
            setMenuOpen(false);
            setEmojiOpen((open) => !open);
          }}
          style={[styles.iconBtn, (!joined || sending) && styles.disabled]}
        >
          <Ionicons name="happy-outline" size={20} color={C.muted} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={
            hasAttachment
              ? "Add a caption…"
              : selectedReplyIds.length
                ? `Reply to ${selectedReplyIds.length}…`
                : placeholder
          }
          placeholderTextColor={C.faint}
          multiline
          maxLength={8000}
          editable={!sending && joined}
          textAlignVertical="center"
          style={styles.input}
          accessibilityLabel="Message"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectedReplyIds.length ? "Send reply" : "Send message"}
          disabled={busy || !canSend}
          onPress={() => void submit()}
          style={[styles.sendButton, (busy || !canSend) && styles.sendDisabled]}
        >
          {sending ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="arrow-up" size={20} color="white" />}
        </Pressable>
      </View>

      {replySelectMode ? (
        <ScrollView style={styles.replyList} nestedScrollEnabled>
          {messages.map((message) => {
            const selected = selectedReplyIds.includes(message.id);
            return (
              <Pressable
                key={message.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel="Include in reply"
                disabled={!selected && selectedReplyIds.length >= maxReplyRefs}
                onPress={() => toggleReply(message.id)}
                style={styles.replyRow}
              >
                <View style={[styles.checkbox, selected && styles.checkboxOn]} />
                <Text style={styles.replyRowText} numberOfLines={2}>
                  {message.fromMe ? "You" : "Member"} · {messagePreviewText(message.plaintext)}
                </Text>
                <Text style={styles.include}>Include</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.footer}>
        <Ionicons name="lock-closed" size={12} color={C.green} />
        <Text style={styles.footerText}>End-to-end encrypted</Text>
        <Text style={styles.charCount}>{draft.length}/8000</Text>
      </View>
      {sending ? <Text style={styles.status}>Encrypting and sending…</Text> : null}
      {!!error && <Text style={styles.error}>{error}</Text>}

      {editorOpen && photos[0] ? (
        <NativePhotoEditor
          asset={photos[0]}
          onCancel={() => {
            setEditorOpen(false);
            setPhotos([]);
          }}
          onSave={(asset) => {
            setPhotos([asset]);
            setEditorOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 9,
    paddingHorizontal: 12,
    paddingBottom: 9,
    backgroundColor: C.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    gap: 8,
  },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 10 },
  chip: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    justifyContent: "center",
    backgroundColor: C.bg,
  },
  chipActive: { backgroundColor: C.purple, borderColor: C.purple },
  chipText: { color: C.ink, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#FFFFFF" },
  replyCount: { color: C.purple, fontSize: 12, fontWeight: "600" },
  replyBanner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7CBF0",
    backgroundColor: C.lilac,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  replyBannerText: { flex: 1, color: C.ink, fontSize: 12, lineHeight: 16 },
  clear: { color: C.purple, fontSize: 12, fontWeight: "700" },
  attachmentCard: {
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  photoRow: { gap: 6, alignItems: "center" },
  thumb: { width: 52, height: 52, borderRadius: 10 },
  attachmentLabel: { flex: 1, color: C.muted, fontSize: 12 },
  editBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  editText: { color: C.ink, fontSize: 12, fontWeight: "600" },
  removeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  emojiPanel: {
    maxHeight: 180,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    padding: 8,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  emojiBtn: { width: "12.5%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 22 },
  menu: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.bg,
    overflow: "hidden",
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  menuText: { color: C.ink, fontSize: 14 },
  composer: {
    minHeight: 48,
    maxHeight: 125,
    borderRadius: 18,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.line,
    paddingLeft: 6,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  iconBtn: { width: 36, height: 36, marginBottom: 5, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.42 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingTop: 12, paddingBottom: 11, color: C.ink, fontSize: 15, lineHeight: 20 },
  sendButton: { width: 36, height: 36, borderRadius: 13, marginBottom: 5, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.42 },
  replyList: { maxHeight: 160, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  replyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  checkboxOn: { backgroundColor: C.purple, borderColor: C.purple },
  replyRowText: { flex: 1, color: C.muted, fontSize: 12, lineHeight: 16 },
  include: { color: C.faint, fontSize: 11 },
  footer: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 5 },
  footerText: { color: C.muted, fontSize: 10 },
  charCount: { color: C.faint, fontSize: 10, marginLeft: "auto" },
  status: { color: C.muted, fontSize: 11, textAlign: "center" },
  error: { color: "#B42318", fontSize: 12, textAlign: "center" },
});
