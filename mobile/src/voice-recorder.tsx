import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
import { I18nManager, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { readUriBytes } from "./media-io";
import type { NativeMediaAsset } from "./prepare-chat-media";
import { C } from "./ui";
import { compactWave, formatDuration, meteringToLevel, voiceCancelArmed } from "./voice-gesture";

export type RecordedVoiceNote = {
  asset: NativeMediaAsset;
  duration: number;
  wave: number[];
};

type Preview = {
  duration: number;
  levels: number[];
  cancelArmed: boolean;
};

type Props = {
  disabled?: boolean;
  onRecorded: (note: RecordedVoiceNote) => void;
  onError: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  onPreview?: (preview: Preview | null) => void;
};

export function NativeVoiceRecorder({ disabled, onRecorded, onError, onRecordingChange, onPreview }: Props) {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const levelsRef = useRef<number[]>([]);
  const cancelRef = useRef(false);
  const startedAt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    void recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
  }, []);

  function publish(cancelArmed: boolean) {
    onPreview?.({
      duration: Math.max(0, (Date.now() - startedAt.current) / 1000),
      levels: levelsRef.current.slice(-32),
      cancelArmed,
    });
  }

  async function start() {
    if (disabled || holdingRef.current) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission is required for voice notes.");
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const next = new Audio.Recording();
      await next.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await next.startAsync();
      recordingRef.current = next;
      levelsRef.current = [];
      cancelRef.current = false;
      startedAt.current = Date.now();
      holdingRef.current = true;
      setHolding(true);
      onRecordingChange?.(true);
      publish(false);
      timerRef.current = setInterval(() => {
        void next.getStatusAsync().then((status) => {
          if (!status.isRecording) return;
          const level = meteringToLevel("metering" in status ? status.metering : undefined);
          levelsRef.current = [...levelsRef.current, level].slice(-240);
          publish(cancelRef.current);
        }).catch(() => undefined);
      }, 120);
    } catch (cause) {
      holdingRef.current = false;
      setHolding(false);
      onRecordingChange?.(false);
      onPreview?.(null);
      onError(cause instanceof Error ? cause.message : "Could not start recording.");
    }
  }

  async function finish(cancelled: boolean) {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recording = recordingRef.current;
    recordingRef.current = null;
    holdingRef.current = false;
    setHolding(false);
    onRecordingChange?.(false);
    onPreview?.(null);
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (cancelled) return;
      const uri = recording.getURI();
      if (!uri) throw new Error("The voice note could not be saved.");
      const duration = Math.max(0.4, (Date.now() - startedAt.current) / 1000);
      const bytes = await readUriBytes(uri);
      onRecorded({
        duration,
        wave: compactWave(levelsRef.current),
        asset: { uri, bytes, mime: "audio/mp4", fileName: "voice-note.m4a", duration },
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not finish the voice note.");
    }
  }

  const gesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(!disabled)
    .minDistance(0)
    .onBegin(() => { void start(); })
    .onUpdate((event) => {
      cancelRef.current = voiceCancelArmed(event.translationX, I18nManager.isRTL);
      publish(cancelRef.current);
    })
    .onFinalize(() => { void finish(cancelRef.current); });

  return (
    <GestureDetector gesture={gesture}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={holding ? "Release to send the voice note. Slide to cancel." : "Hold to record a voice note"}
        disabled={disabled}
        style={[styles.button, holding && styles.recording, disabled && styles.disabled]}
      >
        <Ionicons name="mic" size={18} color={holding ? "#FFFFFF" : C.muted} />
      </Pressable>
    </GestureDetector>
  );
}

export function VoiceRecordingBar({ preview }: { preview: { duration: number; levels: number[]; cancelArmed: boolean } }) {
  return (
    <View style={[styles.bar, preview.cancelArmed && styles.barCancel]} accessibilityLabel="Recording voice note">
      <View style={styles.wave}>
        {preview.levels.slice(-24).map((level, index) => (
          <View key={`${index}-${level}`} style={[styles.barLine, { height: 6 + level * 22 }]} />
        ))}
      </View>
      <Text style={styles.time}>{formatDuration(preview.duration)}</Text>
      <Text style={styles.cancel}>{preview.cancelArmed ? "Release to cancel" : "Slide to cancel"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 36,
    height: 36,
    borderRadius: 13,
    marginBottom: 5,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.line,
  },
  recording: { backgroundColor: "#C45B5B", borderColor: "#C45B5B" },
  disabled: { opacity: 0.42 },
  bar: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7C7C7",
    backgroundColor: "#FBF4F4",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  barCancel: { backgroundColor: "#F4F4F5", borderColor: C.line },
  wave: { flex: 1, height: 32, flexDirection: "row", alignItems: "center", gap: 2 },
  barLine: { width: 3, borderRadius: 2, backgroundColor: "#C45B5B" },
  time: { color: C.ink, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "700" },
  cancel: { color: C.muted, fontSize: 11 },
});
