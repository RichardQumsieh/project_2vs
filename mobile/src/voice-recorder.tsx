import { Ionicons } from "@expo/vector-icons";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
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

const voiceNoteOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

type Props = {
  disabled?: boolean;
  onRecorded: (note: RecordedVoiceNote) => void;
  onError: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  onPreview?: (preview: Preview | null) => void;
};

export function NativeVoiceRecorder({ disabled, onRecorded, onError, onRecordingChange, onPreview }: Props) {
  const recorder = useAudioRecorder(voiceNoteOptions);
  const levelsRef = useRef<number[]>([]);
  const cancelRef = useRef(false);
  const activeRef = useRef(false);
  const startedAt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorder.getStatus().isRecording) void recorder.stop().catch(() => undefined);
  }, [recorder]);

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
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission is required for voice notes.");
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(voiceNoteOptions);
      recorder.record();
      activeRef.current = true;
      levelsRef.current = [];
      cancelRef.current = false;
      startedAt.current = Date.now();
      holdingRef.current = true;
      setHolding(true);
      onRecordingChange?.(true);
      publish(false);
      timerRef.current = setInterval(() => {
        const status = recorder.getStatus();
        if (!status.isRecording) return;
        levelsRef.current = [...levelsRef.current, meteringToLevel(status.metering)].slice(-240);
        publish(cancelRef.current);
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
    const active = activeRef.current;
    activeRef.current = false;
    holdingRef.current = false;
    setHolding(false);
    onRecordingChange?.(false);
    onPreview?.(null);
    if (!active) return;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (cancelled) return;
      const uri = recorder.uri;
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
