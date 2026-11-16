"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { transcribeVoiceAudio } from "@/lib/ai/voice-transcription";
import {
  maxVoiceNoteSourceBytes,
  resampleMonoAudio,
  voiceNoteBitrate,
} from "@/lib/crypto/voice-note";

export type RecordedVoiceNote = {
  file: File;
  duration: number;
  transcript: string;
  transcriptionError?: string;
};

const preferredMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];
function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function VoiceNoteRecorder({
  disabled,
  onRecorded,
  onError,
  onRecordingChange,
}: {
  disabled: boolean;
  onRecorded: (note: RecordedVoiceNote) => void;
  onError: (message: string | null) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcriptionProgress, setTranscriptionProgress] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);
  const mountedRef = useRef(false);
  const callbacksRef = useRef({ onRecorded, onError, onRecordingChange });
  useEffect(() => {
    callbacksRef.current = { onRecorded, onError, onRecordingChange };
  }, [onError, onRecorded, onRecordingChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRef.current = true;
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function transcribe(blob: Blob) {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const channels = Array.from(
        { length: decoded.numberOfChannels },
        (_, index) => decoded.getChannelData(index),
      );
      const audio = resampleMonoAudio(channels, decoded.sampleRate);
      return await transcribeVoiceAudio(audio, ({ percent }) => {
        if (mountedRef.current) {
          setTranscriptionProgress(
            typeof percent === "number" ? Math.round(percent) : null,
          );
        }
      });
    } finally {
      await context.close();
    }
  }

  async function startRecording() {
    callbacksRef.current.onError(null);
    callbacksRef.current.onRecordingChange(true);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacksRef.current.onRecordingChange(false);
      callbacksRef.current.onError("Voice recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = preferredMimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: voiceNoteBitrate,
      });
      const chunks: BlobPart[] = [];
      discardRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (mountedRef.current) setRecording(false);
        if (discardRef.current) {
          discardRef.current = false;
          callbacksRef.current.onRecordingChange(false);
          return;
        }
        const duration = Math.max(0.1, (Date.now() - startedAtRef.current) / 1000);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size === 0 || blob.size > maxVoiceNoteSourceBytes) {
          callbacksRef.current.onRecordingChange(false);
          callbacksRef.current.onError("This voice note exceeds the 6.5 MB encrypted media limit.");
          return;
        }

        setPreparing(true);
        setTranscriptionProgress(null);
        let transcript = "";
        let transcriptionError: string | undefined;
        try {
          transcript = (await transcribe(blob)).slice(0, 4000);
        } catch (error) {
          transcriptionError = error instanceof Error
            ? error.message
            : "On-device captions failed. You can still add a caption manually.";
        } finally {
          if (mountedRef.current) {
            setPreparing(false);
            setTranscriptionProgress(null);
          }
          callbacksRef.current.onRecordingChange(false);
        }
        if (!mountedRef.current) return;
        const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-note.${extension}`, { type: blob.type });
        callbacksRef.current.onRecorded({
          file,
          duration,
          transcript,
          ...(transcriptionError ? { transcriptionError } : {}),
        });
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (mountedRef.current) setRecording(false);
        callbacksRef.current.onRecordingChange(false);
        discardRef.current = true;
        callbacksRef.current.onError("The voice note could not be recorded.");
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      recorder.start(1000);
      setRecording(true);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      callbacksRef.current.onRecordingChange(false);
      callbacksRef.current.onError(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Allow microphone access to record a voice note."
          : error instanceof Error
            ? `Could not start recording: ${error.message}`
            : "Could not start recording.",
      );
    }
  }

  function stopRecording(discard = false) {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    discardRef.current = discard;
    recorder.stop();
  }

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {recording ? (
        <>
          <span role="status" aria-live="polite" className="min-w-[3rem] text-center text-xs tabular-nums text-red-300">
            {formatDuration(elapsedSeconds)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-red-300 hover:bg-red-400/10 sm:size-10"
            aria-label="Stop and transcribe voice note"
            onClick={() => stopRecording()}
          >
            <Square aria-hidden="true" className="size-4 fill-current" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-white/50 sm:size-10"
            aria-label="Discard voice recording"
            onClick={() => stopRecording(true)}
          >
            ×
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-white/65 sm:size-10"
          aria-label={preparing ? "Creating local captions" : "Record a voice note"}
          title={
            preparing
              ? `Preparing local captions${transcriptionProgress === null ? "" : ` (${transcriptionProgress}%)`}`
              : "Record a voice note"
          }
          aria-description="Multilingual captions are created on this device. The speech model may download the first time you use captions."
          disabled={disabled || preparing}
          onClick={() => void startRecording()}
        >
          <Mic aria-hidden="true" className="size-5" />
        </Button>
      )}
      {preparing ? (
        <p role="status" aria-live="polite" className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-white/10 bg-[#151618] px-3 py-2 text-center text-xs text-white/65 sm:left-4 sm:right-4">
          {transcriptionProgress === null
            ? "Creating captions on this device. The multilingual model may download the first time."
            : `Preparing local caption model · ${transcriptionProgress}%`}
        </p>
      ) : null}
    </div>
  );
}
