import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  callLogLabel,
  parseChatPayload,
  type AlbumChatPayload,
  type CallChatPayload,
  type FileChatPayload,
  type ImageChatPayload,
  type ReplyChatPayload,
  type VideoChatPayload,
  type VoiceChatPayload,
} from "../../frontend/lib/chat-payload";
import { api } from "./api";
import { ImageViewer } from "./image-viewer";
import { t } from "./i18n";
import { readRemoteCiphertext, writeDecryptedFile } from "./media-cache";
import { decryptAesGcmBytes, extensionForMime, sanitizeCacheFileName } from "./media-bytes";
import { useColors } from "./theme";

async function openPlaintextFile(conversationId: string, mediaId: string, expectedBytes: number, maxBytes: number, key: string, nonce: string, fileName: string) {
  const { downloadUrl } = await api.mediaDownload(conversationId, mediaId);
  const ciphertext = await readRemoteCiphertext(downloadUrl, expectedBytes, maxBytes);
  const plaintext = await decryptAesGcmBytes(ciphertext, key, nonce);
  return writeDecryptedFile(plaintext, sanitizeCacheFileName(fileName));
}

function MediaFrame({
  loading,
  failed,
  label,
  onRetry,
  fromMe,
  children,
}: {
  loading: boolean;
  failed: boolean;
  label: string;
  onRetry: () => void;
  fromMe: boolean;
  children?: React.ReactNode;
}) {
  const colors = useColors();
  if (!loading && !failed) return <>{children}</>;
  return (
    <View style={[styles.frame, { backgroundColor: fromMe ? "rgba(255,255,255,0.14)" : colors.lilac }]} accessibilityLabel={loading ? t("loading") : t("mediaUnavailable")}>
      {loading ? <ActivityIndicator color={fromMe ? "#FFFFFF" : colors.purple} /> : <Ionicons name="image-outline" size={22} color={fromMe ? "#FFFFFF" : colors.purple} />}
      <Text style={[styles.frameLabel, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{loading ? t("loading") : t("mediaUnavailable")}</Text>
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("retry")} onPress={onRetry} style={styles.retry}>
          <Text style={[styles.retryText, { color: fromMe ? "#FFFFFF" : colors.purple }]}>{t("retry")}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.srOnly}>{label}</Text>
    </View>
  );
}

function usePlainFile(input: {
  conversationId: string;
  mediaId: string;
  bytes: number;
  maxBytes: number;
  key: string;
  nonce: string;
  fileName: string;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setUri(null);
    void openPlaintextFile(input.conversationId, input.mediaId, input.bytes, input.maxBytes, input.key, input.nonce, input.fileName)
      .then((fileUri) => {
        if (!alive) return;
        setUri(fileUri);
        setPhase("ready");
      })
      .catch((error) => {
        console.warn("[sophia-mobile] decrypted media was not cached", error);
        if (alive) setPhase("failed");
      });
    return () => {
      alive = false;
    };
  }, [attempt, input.bytes, input.conversationId, input.fileName, input.key, input.maxBytes, input.mediaId, input.nonce]);
  return { uri, phase, retry: () => setAttempt((value) => value + 1) };
}

function Caption({ text, fromMe }: { text?: string; fromMe: boolean }) {
  const colors = useColors();
  const value = text?.trim();
  if (!value) return null;
  return <Text style={[styles.caption, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{value}</Text>;
}

function EncryptedPhotoView({ conversationId, payload, fromMe }: { conversationId: string; payload: ImageChatPayload; fromMe: boolean }) {
  const file = usePlainFile({
    conversationId,
    mediaId: payload.id,
    bytes: payload.bytes,
    maxBytes: 6_500_000,
    key: payload.k,
    nonce: payload.n,
    fileName: `photo-${payload.id}.${extensionForMime(payload.mime)}`,
  });
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.mediaBlock}>
      <MediaFrame loading={file.phase === "loading"} failed={file.phase === "failed"} label={t("photo")} onRetry={file.retry} fromMe={fromMe}>
        <Pressable accessibilityRole="image" accessibilityLabel={payload.caption?.trim() || t("photo")} onPress={() => setOpen(true)}>
          <Image source={{ uri: file.uri ?? undefined }} style={styles.photo} contentFit="cover" />
        </Pressable>
      </MediaFrame>
      <Caption text={payload.caption} fromMe={fromMe} />
      <ImageViewer uri={open ? file.uri : null} mime={payload.mime} onClose={() => setOpen(false)} />
    </View>
  );
}

function EncryptedAlbumView({ conversationId, payload, fromMe }: { conversationId: string; payload: AlbumChatPayload; fromMe: boolean }) {
  return (
    <View style={styles.mediaBlock}>
      <View style={styles.albumGrid}>
        {payload.items.map((item) => (
          <EncryptedPhotoView key={item.id} conversationId={conversationId} payload={{ type: "image", ...item }} fromMe={fromMe} />
        ))}
      </View>
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function ChatVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (next) => {
    next.loop = false;
    next.play();
  });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

function EncryptedVideoView({ conversationId, payload, fromMe }: { conversationId: string; payload: VideoChatPayload; fromMe: boolean }) {
  const file = usePlainFile({
    conversationId,
    mediaId: payload.id,
    bytes: payload.bytes,
    maxBytes: 6_500_000,
    key: payload.k,
    nonce: payload.n,
    fileName: `video-${payload.id}.${extensionForMime(payload.mime)}`,
  });
  const [poster, setPoster] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!file.uri) return;
    let alive = true;
    void VideoThumbnails.getThumbnailAsync(file.uri, { time: 0, quality: 0.6 })
      .then((thumb) => {
        if (alive) setPoster(thumb.uri);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [file.uri]);
  return (
    <View style={styles.mediaBlock}>
      <MediaFrame loading={file.phase === "loading"} failed={file.phase === "failed"} label={t("video")} onRetry={file.retry} fromMe={fromMe}>
        {playing && file.uri ? (
          <ChatVideo uri={file.uri} />
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={t("video")} onPress={() => setPlaying(true)} style={styles.video}>
            {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            <View style={styles.playBadge}><Ionicons name="play" size={18} color="#FFFFFF" /></View>
          </Pressable>
        )}
      </MediaFrame>
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function EncryptedVoiceView({ conversationId, payload, fromMe }: { conversationId: string; payload: VoiceChatPayload; fromMe: boolean }) {
  const colors = useColors();
  const file = usePlainFile({
    conversationId,
    mediaId: payload.id,
    bytes: payload.bytes,
    maxBytes: 6_500_000,
    key: payload.k,
    nonce: payload.n,
    fileName: `voice-${payload.id}.${extensionForMime(payload.mime)}`,
  });
  const [playing, setPlaying] = useState(false);
  const playerRef = React.useRef<AudioPlayer | null>(null);
  useEffect(() => () => {
    playerRef.current?.remove();
    playerRef.current = null;
  }, []);

  async function toggle() {
    if (!file.uri) return;
    const existing = playerRef.current;
    if (existing) {
      if (existing.playing) {
        existing.pause();
        setPlaying(false);
        return;
      }
      existing.play();
      setPlaying(true);
      return;
    }
    const created = createAudioPlayer(file.uri);
    created.addListener("playbackStatusUpdate", (status) => {
      if (!status.isLoaded) return;
      setPlaying(status.playing);
      if (status.didJustFinish) setPlaying(false);
    });
    playerRef.current = created;
    created.play();
    setPlaying(true);
  }

  return (
    <View style={styles.mediaBlock}>
      <MediaFrame loading={file.phase === "loading"} failed={file.phase === "failed"} label={t("voiceNote")} onRetry={file.retry} fromMe={fromMe}>
        <Pressable accessibilityRole="button" accessibilityLabel={playing ? t("voiceNote") : t("voiceNote")} onPress={() => void toggle()} style={[styles.voiceBtn, { backgroundColor: fromMe ? "rgba(255,255,255,0.16)" : colors.lilac }]}>
          <Ionicons name={playing ? "pause" : "play"} size={16} color={fromMe ? "#FFFFFF" : colors.purple} />
          <View style={styles.waveRow}>
            {(payload.wave?.length ? payload.wave : [0.3, 0.6, 0.4, 0.8, 0.5, 0.7, 0.35]).slice(0, 32).map((level, index) => (
              <View key={`${payload.id}-${index}`} style={[styles.waveBar, { height: 4 + level * 16, backgroundColor: fromMe ? "#FFFFFF" : colors.purple }]} />
            ))}
          </View>
          <Text style={[styles.voiceLabel, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{Math.round(payload.duration)}s</Text>
        </Pressable>
      </MediaFrame>
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function EncryptedFileView({ conversationId, payload, fromMe }: { conversationId: string; payload: FileChatPayload; fromMe: boolean }) {
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true);
    setFailed(false);
    try {
      const uri = await openPlaintextFile(
        conversationId,
        payload.id,
        payload.bytes,
        450_000_016,
        payload.k,
        payload.n,
        payload.name,
      );
      await Linking.openURL(uri);
    } catch (error) {
      console.warn("[sophia-mobile] file was not opened", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.mediaBlock}>
      <Pressable accessibilityRole="button" accessibilityLabel={payload.name} onPress={() => void open()} style={[styles.fileBtn, { backgroundColor: fromMe ? "rgba(255,255,255,0.16)" : colors.lilac }]}>
        {busy ? <ActivityIndicator color={fromMe ? "#FFFFFF" : colors.purple} /> : <Ionicons name="document-text-outline" size={18} color={fromMe ? "#FFFFFF" : colors.purple} />}
        <Text style={[styles.voiceLabel, { color: fromMe ? "#FFFFFF" : colors.ink }]} numberOfLines={2}>{payload.name}</Text>
      </Pressable>
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("retry")} onPress={() => void open()}>
          <Text style={[styles.retryText, { color: fromMe ? "#FFFFFF" : colors.purple }]}>{t("mediaUnavailable")} · {t("retry")}</Text>
        </Pressable>
      ) : null}
      {payload.containsExternalLinks ? <Text style={[styles.meta, { color: fromMe ? "#DDD5EB" : colors.faint }]}>Contains external links</Text> : null}
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function CallView({ payload, fromMe }: { payload: CallChatPayload; fromMe: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.voiceBtn, { backgroundColor: fromMe ? "rgba(255,255,255,0.16)" : colors.lilac }]}>
      <Ionicons name={payload.mode === "video" ? "videocam" : "call"} size={16} color={fromMe ? "#FFFFFF" : colors.purple} />
      <Text style={[styles.voiceLabel, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{callLogLabel(payload)}</Text>
    </View>
  );
}

function ReplyView({ payload, fromMe }: { payload: ReplyChatPayload; fromMe: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.mediaBlock}>
      <View style={[styles.replyBox, { borderStartColor: fromMe ? "#E8DFF8" : colors.purple }]}>
        {payload.refs.map((ref) => (
          <Text key={ref.id} style={[styles.replyRef, { color: fromMe ? "#DDD5EB" : colors.muted }]} numberOfLines={2}>
            {ref.fromMe ? "You" : "Member"} · {ref.preview}
          </Text>
        ))}
      </View>
      {payload.body ? <Text style={[styles.body, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{payload.body}</Text> : null}
    </View>
  );
}

export function NativeMessageBody({ conversationId, plaintext, fromMe }: { conversationId: string; plaintext: string; fromMe: boolean }) {
  const colors = useColors();
  const payload = parseChatPayload(plaintext);
  if (payload.type === "image") return <EncryptedPhotoView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  if (payload.type === "album") return <EncryptedAlbumView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  if (payload.type === "video") return <EncryptedVideoView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  if (payload.type === "voice") return <EncryptedVoiceView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  if (payload.type === "file") return <EncryptedFileView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  if (payload.type === "reply") return <ReplyView payload={payload} fromMe={fromMe} />;
  if (payload.type === "call") return <CallView payload={payload} fromMe={fromMe} />;
  if (payload.type === "location") {
    return <Text style={[styles.body, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{payload.name?.trim() || "Shared location"}</Text>;
  }
  return <Text selectable style={[styles.body, { color: fromMe ? "#FFFFFF" : colors.ink }]}>{payload.text}</Text>;
}

const styles = StyleSheet.create({
  mediaBlock: { gap: 6 },
  frame: { width: 220, minHeight: 132, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 8, padding: 12 },
  frameLabel: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  retry: { minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  retryText: { fontSize: 13, fontWeight: "700" },
  srOnly: { height: 0, width: 0, opacity: 0 },
  photo: { width: 220, height: 220, borderRadius: 14, backgroundColor: "#1A1F2C" },
  albumGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, maxWidth: 230 },
  video: { width: 230, height: 160, borderRadius: 14, backgroundColor: "#11141C", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  playBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  waveRow: { flex: 1, height: 22, flexDirection: "row", alignItems: "center", gap: 2 },
  waveBar: { width: 3, borderRadius: 2 },
  caption: { fontSize: 15, lineHeight: 21 },
  meta: { fontSize: 11 },
  voiceBtn: { minHeight: 44, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  fileBtn: { minHeight: 44, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  voiceLabel: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  replyBox: { borderStartWidth: 3, paddingStart: 8, gap: 4 },
  replyRef: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 16, lineHeight: 22 },
});
