import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { readUriBytes } from "./media-io";
import type { NativeMediaAsset } from "./prepare-chat-media";
import { C } from "./ui";

export type RecordedVoiceNote = {
  asset: NativeMediaAsset;
  duration: number;
};

type Props = {
  disabled?: boolean;
  onRecorded: (note: RecordedVoiceNote) => void;
  onError: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
};

export function NativeVoiceRecorder({ disabled, onRecorded, onError, onRecordingChange }: Props) {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => () => {
    void recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
  }, []);

  async function start() {
    if (disabled || busy || recording) return;
    setBusy(true);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone permission is required for voice notes.");
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const next = new Audio.Recording();
      await next.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await next.startAsync();
      recordingRef.current = next;
      startedAt.current = Date.now();
      setRecording(true);
      onRecordingChange?.(true);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not start recording.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!recordingRef.current) return;
    setBusy(true);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setRecording(false);
      onRecordingChange?.(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (!uri) throw new Error("The voice note could not be saved.");
      const duration = Math.max(0.4, (Date.now() - startedAt.current) / 1000);
      const bytes = await readUriBytes(uri);
      onRecorded({
        duration,
        asset: {
          uri,
          bytes,
          mime: "audio/mp4",
          fileName: "voice-note.m4a",
          duration,
        },
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not finish the voice note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? "Stop voice note" : "Record voice note"}
      disabled={disabled || busy}
      onPress={() => void (recording ? stop() : start())}
      style={[styles.button, recording && styles.recording, (disabled || busy) && styles.disabled]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={recording ? "#FFFFFF" : C.purple} />
      ) : (
        <Ionicons name={recording ? "stop" : "mic"} size={18} color={recording ? "#FFFFFF" : C.muted} />
      )}
      {recording ? <Text style={styles.live}>Rec</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 36,
    height: 36,
    borderRadius: 13,
    marginBottom: 5,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.line,
  },
  recording: { backgroundColor: "#C45B5B", borderColor: "#C45B5B" },
  disabled: { opacity: 0.42 },
  live: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
});
