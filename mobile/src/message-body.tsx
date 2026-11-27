import { Ionicons } from "@expo/vector-icons";
import { Audio, Video, ResizeMode } from "expo-av";
import * as VideoThumbnails from "expo-video-thumbnails";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { decryptPhotoBytes } from "../../frontend/lib/crypto/media";
import { decryptVideoBytes } from "../../frontend/lib/crypto/video";
import { decryptVoiceNoteBytes } from "../../frontend/lib/crypto/voice-note";
import { decryptFileAttachment } from "../../frontend/lib/crypto/file-attachment";
import { api } from "./api";
import { blobToBytes, bytesToDataUri, writeCacheBytes } from "./media-io";
import { C } from "./ui";

async function downloadCiphertext(conversationId: string, mediaId: string, expectedBytes: number, maxBytes: number) {
  const { downloadUrl } = await api.mediaDownload(conversationId, mediaId);
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error("The attachment could not be downloaded.");
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (ciphertext.byteLength !== expectedBytes || ciphertext.byteLength > maxBytes) {
    throw new Error("The downloaded attachment has an invalid size.");
  }
  return ciphertext;
}

function Caption({ text, fromMe }: { text?: string; fromMe: boolean }) {
  const value = text?.trim();
  if (!value) return null;
  return <Text style={[styles.caption, fromMe && styles.captionMine]}>{value}</Text>;
}

function EncryptedPhotoView({
  conversationId,
  payload,
  fromMe,
}: {
  conversationId: string;
  payload: ImageChatPayload;
  fromMe: boolean;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ciphertext = await downloadCiphertext(conversationId, payload.id, payload.bytes, 6_500_000);
        const blob = await decryptPhotoBytes(ciphertext, payload.k, payload.n, payload.mime);
        const bytes = await blobToBytes(blob);
        if (!alive) return;
        setUri(bytesToDataUri(bytes, payload.mime));
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "This photo could not be opened.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [conversationId, payload.id, payload.bytes, payload.k, payload.n, payload.mime]);

  if (loading) return <Text style={[styles.meta, fromMe && styles.metaMine]}>Loading photo…</Text>;
  if (error || !uri) return <Text style={styles.error}>{error || "This photo could not be opened."}</Text>;
  return (
    <View style={styles.mediaBlock}>
      <Image source={{ uri }} style={styles.photo} resizeMode="cover" accessibilityLabel={payload.caption?.trim() || "Photo"} />
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function EncryptedAlbumView({
  conversationId,
  payload,
  fromMe,
}: {
  conversationId: string;
  payload: AlbumChatPayload;
  fromMe: boolean;
}) {
  return (
    <View style={styles.mediaBlock}>
      <View style={styles.albumGrid}>
        {payload.items.map((item) => (
          <EncryptedPhotoView
            key={item.id}
            conversationId={conversationId}
            payload={{ type: "image", ...item }}
            fromMe={fromMe}
          />
        ))}
      </View>
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function EncryptedVideoView({
  conversationId,
  payload,
}: {
  conversationId: string;
  payload: VideoChatPayload;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ciphertext = await downloadCiphertext(conversationId, payload.id, payload.bytes, 6_500_000);
        const blob = await decryptVideoBytes(ciphertext, payload.k, payload.n, payload.mime);
        const bytes = await blobToBytes(blob);
        const extension = payload.mime === "video/mp4" ? "mp4" : "webm";
        const fileUri = await writeCacheBytes(bytes, `sophia-video-${payload.id}.${extension}`);
        if (!alive) return;
        setUri(fileUri);
        try {
          const thumb = await VideoThumbnails.getThumbnailAsync(fileUri, { time: 0, quality: 0.6 });
          if (alive) setPoster(thumb.uri);
        } catch {
          // Playback still works when a poster frame cannot be generated.
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "This video could not be opened.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [conversationId, payload.id, payload.bytes, payload.k, payload.n, payload.mime]);

  if (loading) return <Text style={styles.meta}>Loading video…</Text>;
  if (error || !uri) return <Text style={styles.error}>{error || "This video could not be opened."}</Text>;
  return (
    <View style={styles.mediaBlock}>
      {playing ? (
        <Video
          source={{ uri }}
          style={styles.video}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping={false}
        />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={() => setPlaying(true)} style={styles.video}>
          {poster ? <Image source={{ uri: poster }} style={styles.videoFill} resizeMode="cover" /> : null}
          <View style={styles.playBadge}><Ionicons name="play" size={18} color="#FFFFFF" /></View>
        </Pressable>
      )}
      <Caption text={payload.caption} fromMe={false} />
    </View>
  );
}

function EncryptedVoiceView({
  conversationId,
  payload,
  fromMe,
}: {
  conversationId: string;
  payload: VoiceChatPayload;
  fromMe: boolean;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const soundRef = React.useRef<Audio.Sound | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const ciphertext = await downloadCiphertext(conversationId, payload.id, payload.bytes, 6_500_000);
        const blob = await decryptVoiceNoteBytes(ciphertext, payload.k, payload.n, payload.mime);
        const bytes = await blobToBytes(blob);
        const extension = payload.mime === "audio/mp4" ? "m4a" : payload.mime === "audio/ogg" ? "ogg" : "webm";
        const fileUri = await writeCacheBytes(bytes, `sophia-voice-${payload.id}.${extension}`);
        if (!alive) return;
        setUri(fileUri);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "This voice note could not be opened.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, [conversationId, payload.id, payload.bytes, payload.k, payload.n, payload.mime]);

  async function toggle() {
    if (!uri) return;
    const existing = soundRef.current;
    if (existing) {
      const status = await existing.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await existing.pauseAsync();
        setPlaying(false);
        return;
      }
      await existing.playAsync();
      setPlaying(true);
      return;
    }
    const created = new Audio.Sound();
    await created.loadAsync({ uri });
    created.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      setPlaying(status.isPlaying);
      if (status.didJustFinish) setPlaying(false);
    });
    soundRef.current = created;
    await created.playAsync();
    setPlaying(true);
  }

  if (loading) return <Text style={[styles.meta, fromMe && styles.metaMine]}>Loading voice note…</Text>;
  if (error || !uri) return <Text style={styles.error}>{error || "This voice note could not be opened."}</Text>;
  return (
    <View style={styles.mediaBlock}>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? "Pause voice note" : "Play voice note"} onPress={() => void toggle()} style={[styles.voiceBtn, fromMe && styles.voiceBtnMine]}>
        <Ionicons name={playing ? "pause" : "play"} size={16} color={fromMe ? "#FFFFFF" : C.purple} />
        <View style={styles.waveRow}>
          {(payload.wave?.length ? payload.wave : [0.3, 0.6, 0.4, 0.8, 0.5, 0.7, 0.35]).slice(0, 32).map((level, index) => (
            <View key={`${payload.id}-${index}`} style={[styles.waveBar, { height: 4 + level * 16, backgroundColor: fromMe ? "#FFFFFF" : C.purple }]} />
          ))}
        </View>
        <Text style={[styles.voiceLabel, fromMe && styles.captionMine]}>
          {Math.round(payload.duration)}s
        </Text>
      </Pressable>
      <Caption text={payload.caption} fromMe={fromMe} />
    </View>
  );
}

function EncryptedFileView({
  conversationId,
  payload,
  fromMe,
}: {
  conversationId: string;
  payload: FileChatPayload;
  fromMe: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      const ciphertext = await downloadCiphertext(
        conversationId,
        payload.id,
        payload.bytes,
        450_000_016,
      );
      const blob = await decryptFileAttachment(ciphertext.buffer, payload.k, payload.n);
      const bytes = await blobToBytes(blob);
      const uri = await writeCacheBytes(bytes, payload.name.replace(/[^\w.-]+/g, "_"));
      const canOpen = await Linking.canOpenURL(uri);
      if (!canOpen) throw new Error("No app is available to open this file.");
      await Linking.openURL(uri);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This file could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.mediaBlock}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${payload.name}`} onPress={() => void open()} style={[styles.fileBtn, fromMe && styles.voiceBtnMine]}>
        {busy ? <ActivityIndicator color={fromMe ? "#FFFFFF" : C.purple} /> : <Ionicons name="document-text-outline" size={16} color={fromMe ? "#FFFFFF" : C.purple} />}
        <Text style={[styles.voiceLabel, fromMe && styles.captionMine]} numberOfLines={2}>{payload.name}</Text>
      </Pressable>
      {payload.containsExternalLinks ? (
        <Text style={[styles.meta, fromMe && styles.metaMine]}>Contains external links</Text>
      ) : null}
      <Caption text={payload.caption} fromMe={fromMe} />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function CallView({ payload, fromMe }: { payload: CallChatPayload; fromMe: boolean }) {
  return (
    <View style={styles.mediaBlock}>
      <View style={styles.voiceBtn}>
        <Ionicons name={payload.mode === "video" ? "videocam" : "call"} size={16} color={fromMe ? "#FFFFFF" : C.purple} />
        <Text style={[styles.voiceLabel, fromMe && styles.captionMine]}>{callLogLabel(payload)}</Text>
      </View>
    </View>
  );
}

function ReplyView({ payload, fromMe }: { payload: ReplyChatPayload; fromMe: boolean }) {
  return (
    <View style={styles.mediaBlock}>
      <View style={[styles.replyBox, fromMe && styles.replyBoxMine]}>
        {payload.refs.map((ref) => (
          <Text key={ref.id} style={[styles.replyRef, fromMe && styles.metaMine]} numberOfLines={2}>
            {ref.fromMe ? "You" : "Member"} · {ref.preview}
          </Text>
        ))}
      </View>
      <Text style={[styles.body, fromMe && styles.captionMine]}>{payload.body}</Text>
    </View>
  );
}

export function NativeMessageBody({
  conversationId,
  plaintext,
  fromMe,
}: {
  conversationId: string;
  plaintext: string;
  fromMe: boolean;
}) {
  const payload = parseChatPayload(plaintext);
  if (payload.type === "image") {
    return <EncryptedPhotoView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "album") {
    return <EncryptedAlbumView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "video") {
    return <EncryptedVideoView conversationId={conversationId} payload={payload} />;
  }
  if (payload.type === "voice") {
    return <EncryptedVoiceView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "file") {
    return <EncryptedFileView conversationId={conversationId} payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "reply") {
    return <ReplyView payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "call") {
    return <CallView payload={payload} fromMe={fromMe} />;
  }
  if (payload.type === "location") {
    return (
      <Text style={[styles.body, fromMe && styles.captionMine]}>
        {payload.name?.trim() || "Shared location"}
      </Text>
    );
  }
  return <Text selectable style={[styles.body, fromMe && styles.captionMine]}>{payload.text}</Text>;
}

const styles = StyleSheet.create({
  mediaBlock: { gap: 6 },
  photo: { width: 220, height: 220, borderRadius: 14, backgroundColor: "#1A1F2C" },
  albumGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, maxWidth: 230 },
  video: { width: 230, height: 160, borderRadius: 14, backgroundColor: "#11141C", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  videoFill: { ...StyleSheet.absoluteFill },
  playBadge: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  waveRow: { flex: 1, height: 22, flexDirection: "row", alignItems: "center", gap: 2 },
  waveBar: { width: 3, borderRadius: 2 },
  caption: { color: C.ink, fontSize: 14, lineHeight: 20 },
  captionMine: { color: "#FFFFFF" },
  meta: { color: C.faint, fontSize: 11 },
  metaMine: { color: "#DDD5EB" },
  error: { color: "#F5A8A8", fontSize: 12 },
  voiceBtn: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.lilac,
  },
  voiceBtnMine: { backgroundColor: "rgba(255,255,255,0.16)" },
  fileBtn: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.lilac,
  },
  voiceLabel: { color: C.ink, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  replyBox: {
    borderLeftWidth: 3,
    borderLeftColor: C.purple,
    paddingLeft: 8,
    gap: 4,
    marginBottom: 2,
  },
  replyBoxMine: { borderLeftColor: "#E8DFF8" },
  replyRef: { color: C.muted, fontSize: 11, lineHeight: 15 },
  body: { color: C.ink, fontSize: 15, lineHeight: 21 },
});
