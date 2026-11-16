"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
} from "lucide-react";
import { api, type PublicUser, wsUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";

type CallMode = "audio" | "video";
type CallView = {
  callId: string;
  conversationId: string;
  peer: PublicUser;
  mode: CallMode;
  direction: "incoming" | "outgoing";
  phase: "ringing" | "connecting" | "active";
};
type CallDescription = RTCSessionDescriptionInit;
type CallSignal =
  | {
      type: "call:invite";
      callId: string;
      conversationId: string;
      mode: CallMode;
      offer: CallDescription;
      senderId: string;
      peer: PublicUser;
    }
  | {
      type: "call:answer";
      callId: string;
      conversationId: string;
      answer: CallDescription;
      senderId: string;
    }
  | {
      type: "call:ice";
      callId: string;
      conversationId: string;
      candidate: RTCIceCandidateInit;
      senderId: string;
    }
  | {
      type: "call:reject" | "call:end";
      callId: string;
      conversationId: string;
      senderId: string;
    }
  | { type: "call:error"; message: string };
type OutgoingSignal =
  | {
      type: "call:invite";
      callId: string;
      conversationId: string;
      mode: CallMode;
      offer: CallDescription;
    }
  | {
      type: "call:answer";
      callId: string;
      conversationId: string;
      answer: CallDescription;
    }
  | {
      type: "call:ice";
      callId: string;
      conversationId: string;
      candidate: RTCIceCandidateInit;
    }
  | {
      type: "call:reject" | "call:end";
      callId: string;
      conversationId: string;
    };
type CallContextValue = {
  call: CallView | null;
  callError: string | null;
  startCall: (conversationId: string, peer: PublicUser, mode: CallMode) => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCallSignal(value: unknown): value is CallSignal {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "call:error") return typeof value.message === "string";
  if (
    typeof value.callId !== "string" ||
    typeof value.conversationId !== "string" ||
    typeof value.senderId !== "string"
  ) {
    return false;
  }
  if (value.type === "call:invite") {
    return (
      (value.mode === "audio" || value.mode === "video") &&
      isRecord(value.offer) &&
      typeof value.offer.sdp === "string" &&
      isRecord(value.peer) &&
      typeof value.peer.id === "string" &&
      typeof value.peer.username === "string"
    );
  }
  if (value.type === "call:answer") {
    return isRecord(value.answer) && typeof value.answer.sdp === "string";
  }
  if (value.type === "call:ice") {
    return isRecord(value.candidate) && typeof value.candidate.candidate === "string";
  }
  return value.type === "call:reject" || value.type === "call:end";
}

export function CallProvider({
  children,
  enabled,
  userId,
}: {
  children: ReactNode;
  enabled: boolean;
  userId: string | null;
}) {
  const [call, setCall] = useState<CallView | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callRef = useRef<CallView | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingLocalCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingRemoteCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localSignalingReadyRef = useRef(false);
  const handleSignalRef = useRef<(value: unknown) => void>(() => {});
  const finishCallRef = useRef<() => void>(() => {});

  const updateCall = useCallback((next: CallView | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const showError = useCallback((message: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setCallError(message);
    errorTimerRef.current = setTimeout(() => setCallError(null), 8_000);
  }, []);

  const sendSignal = useCallback(async (signal: OutgoingSignal) => {
    const connectingSocket = socketRef.current;
    if (
      !connectingSocket ||
      connectingSocket.readyState === WebSocket.CLOSED ||
      connectingSocket.readyState === WebSocket.CLOSING
    ) {
      throw new Error("Call signaling is reconnecting. Please try again.");
    }
    if (connectingSocket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Could not connect to call signaling."));
        }, 5_000);
        const cleanup = () => {
          clearTimeout(timeout);
          connectingSocket.removeEventListener("open", onOpen);
          connectingSocket.removeEventListener("error", onError);
          connectingSocket.removeEventListener("close", onError);
        };
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("Could not connect to call signaling."));
        };
        connectingSocket.addEventListener("open", onOpen, { once: true });
        connectingSocket.addEventListener("error", onError, { once: true });
        connectingSocket.addEventListener("close", onError, { once: true });
      });
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Call signaling is unavailable. Please try again.");
    }
    socket.send(JSON.stringify(signal));
  }, []);

  const finishCall = useCallback(() => {
    if (callTimerRef.current) clearTimeout(callTimerRef.current);
    callTimerRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    for (const track of [
      ...(localStreamRef.current?.getTracks() ?? []),
      ...(remoteStreamRef.current?.getTracks() ?? []),
    ]) {
      track.stop();
    }
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setAudioMuted(false);
    setCameraEnabled(true);
    incomingOfferRef.current = null;
    pendingLocalCandidatesRef.current = [];
    pendingRemoteCandidatesRef.current = [];
    localSignalingReadyRef.current = false;
    updateCall(null);
  }, [updateCall]);
  useEffect(() => {
    finishCallRef.current = finishCall;
  }, [finishCall]);

  const createPeerConnection = useCallback(async (
    current: CallView,
  ) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone or camera access.");
    }
    const { iceServers } = await api.callIceServers();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: current.mode === "video",
    });
    let connection: RTCPeerConnection;
    try {
      connection = new RTCPeerConnection({ iceServers });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const remote = new MediaStream();
    peerConnectionRef.current = connection;
    localStreamRef.current = stream;
    remoteStreamRef.current = remote;
    setLocalStream(stream);
    setRemoteStream(remote);
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.ontrack = (event) => {
      const tracks = event.streams[0]?.getTracks() ?? [event.track];
      tracks.forEach((track) => {
        if (!remote.getTracks().some((existing) => existing.id === track.id)) {
          remote.addTrack(track);
        }
      });
      setRemoteStream(new MediaStream(remote.getTracks()));
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON();
      if (!localSignalingReadyRef.current) {
        pendingLocalCandidatesRef.current.push(candidate);
        return;
      }
      void sendSignal({
        type: "call:ice",
        callId: current.callId,
        conversationId: current.conversationId,
        candidate,
      }).catch((error: unknown) => {
        showError(error instanceof Error ? error.message : "Could not send a call network candidate.");
      });
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        const latest = callRef.current;
        if (latest?.callId === current.callId) updateCall({ ...latest, phase: "active" });
      } else if (connection.connectionState === "failed") {
        void sendSignal({
          type: "call:end",
          callId: current.callId,
          conversationId: current.conversationId,
        }).catch(() => undefined);
        finishCallRef.current();
        showError("Could not establish the call. Try another network or configure a TURN relay.");
      }
    };
    return connection;
  }, [sendSignal, showError, updateCall]);

  const flushLocalCandidates = useCallback(async (current: CallView) => {
    localSignalingReadyRef.current = true;
    const candidates = pendingLocalCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      await sendSignal({
        type: "call:ice",
        callId: current.callId,
        conversationId: current.conversationId,
        candidate,
      });
    }
  }, [sendSignal]);

  const flushRemoteCandidates = useCallback(async (connection: RTCPeerConnection) => {
    const candidates = pendingRemoteCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      await connection.addIceCandidate(candidate);
    }
  }, []);

  const sendTerminalSignal = useCallback((type: "call:reject" | "call:end") => {
    const current = callRef.current;
    if (!current) return;
    void sendSignal({
      type,
      callId: current.callId,
      conversationId: current.conversationId,
    }).catch((error: unknown) => {
      showError(error instanceof Error ? error.message : "Could not notify the other participant.");
    });
    finishCall();
  }, [finishCall, sendSignal, showError]);

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    const offer = incomingOfferRef.current;
    if (!current || current.direction !== "incoming" || !offer) return;
    if (callTimerRef.current) clearTimeout(callTimerRef.current);
    callTimerRef.current = null;
    updateCall({ ...current, phase: "connecting" });
    try {
      const connection = await createPeerConnection(current);
      await connection.setRemoteDescription(offer);
      await flushRemoteCandidates(connection);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      if (!connection.localDescription) throw new Error("Could not create a call answer.");
      await sendSignal({
        type: "call:answer",
        callId: current.callId,
        conversationId: current.conversationId,
        answer: connection.localDescription.toJSON(),
      });
      await flushLocalCandidates(current);
    } catch (error) {
      void sendSignal({
        type: "call:reject",
        callId: current.callId,
        conversationId: current.conversationId,
      }).catch(() => undefined);
      finishCall();
      showError(error instanceof Error ? error.message : "Could not answer the call.");
    }
  }, [
    createPeerConnection,
    finishCall,
    flushLocalCandidates,
    flushRemoteCandidates,
    sendSignal,
    showError,
    updateCall,
  ]);

  const handleSignal = useCallback((value: unknown) => {
    if (!isCallSignal(value)) return;
    if (value.type === "call:error") {
      showError(value.message);
      return;
    }
    const current = callRef.current;
    if (value.type === "call:invite") {
      if (current) {
        void sendSignal({
          type: "call:reject",
          callId: value.callId,
          conversationId: value.conversationId,
        }).catch(() => undefined);
        return;
      }
      const incoming: CallView = {
        callId: value.callId,
        conversationId: value.conversationId,
        peer: value.peer,
        mode: value.mode,
        direction: "incoming",
        phase: "ringing",
      };
      incomingOfferRef.current = value.offer;
      updateCall(incoming);
      callTimerRef.current = setTimeout(() => {
        void sendSignal({
          type: "call:end",
          callId: incoming.callId,
          conversationId: incoming.conversationId,
        }).catch(() => undefined);
        finishCallRef.current();
        showError("Missed call.");
      }, 40_000);
      return;
    }
    if (
      !current ||
      value.callId !== current.callId ||
      value.conversationId !== current.conversationId ||
      value.senderId !== current.peer.id
    ) {
      return;
    }
    if (value.type === "call:answer") {
      if (current.direction !== "outgoing" || !peerConnectionRef.current) return;
      if (callTimerRef.current) clearTimeout(callTimerRef.current);
      callTimerRef.current = null;
      void peerConnectionRef.current.setRemoteDescription(value.answer)
        .then(() => flushRemoteCandidates(peerConnectionRef.current!))
        .then(() => updateCall({ ...current, phase: "connecting" }))
        .catch((error: unknown) => {
          showError(error instanceof Error ? error.message : "Could not connect the call.");
        });
      return;
    }
    if (value.type === "call:ice") {
      const connection = peerConnectionRef.current;
      if (!connection || !connection.remoteDescription) {
        pendingRemoteCandidatesRef.current.push(value.candidate);
        return;
      }
      void connection.addIceCandidate(value.candidate).catch(() => {
        showError("A call network candidate could not be applied.");
      });
      return;
    }
    if (value.type === "call:reject" || value.type === "call:end") {
      finishCallRef.current();
      showError(value.type === "call:reject" ? "The call was declined." : "The call ended.");
    }
  }, [flushRemoteCandidates, sendSignal, showError, updateCall]);
  useEffect(() => {
    handleSignalRef.current = handleSignal;
  }, [handleSignal]);

  const startCall = useCallback(async (
    conversationId: string,
    peer: PublicUser,
    mode: CallMode,
  ) => {
    if (callRef.current) {
      showError("Finish the current call before starting another.");
      return;
    }
    setCallError(null);
    const current: CallView = {
      callId: crypto.randomUUID(),
      conversationId,
      peer,
      mode,
      direction: "outgoing",
      phase: "connecting",
    };
    updateCall(current);
    try {
      const connection = await createPeerConnection(current);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      if (!connection.localDescription) throw new Error("Could not create a call offer.");
      await sendSignal({
        type: "call:invite",
        callId: current.callId,
        conversationId,
        mode,
        offer: connection.localDescription.toJSON(),
      });
      await flushLocalCandidates(current);
      updateCall({ ...current, phase: "ringing" });
      callTimerRef.current = setTimeout(() => {
        void sendSignal({
          type: "call:end",
          callId: current.callId,
          conversationId,
        }).catch(() => undefined);
        finishCallRef.current();
        showError("No answer. The call ended.");
      }, 40_000);
    } catch (error) {
      finishCallRef.current();
      showError(error instanceof Error ? error.message : "Could not start the call.");
    }
  }, [createPeerConnection, flushLocalCandidates, sendSignal, showError, updateCall]);

  useEffect(() => {
    if (!enabled || !userId) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl());
      socketRef.current = socket;
      socket.onmessage = (event) => {
        try {
          handleSignalRef.current(JSON.parse(event.data) as unknown);
        } catch {
          showError("Could not read a call signaling message.");
        }
      };
      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (event.code === 4401 || event.code === 4403) {
          stopped = true;
          finishCallRef.current();
          if (event.code === 4401) showError("Your session expired. Sign in again to continue calling.");
          return;
        }
        if (!stopped) retryTimerRef.current = setTimeout(connect, 1_000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
      finishCallRef.current();
    };
  }, [enabled, showError, userId]);

  const toggleAudio = () => {
    const next = !audioMuted;
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setAudioMuted(next);
  };
  const toggleCamera = () => {
    const next = !cameraEnabled;
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  };

  return (
    <CallContext.Provider value={{ call, callError, startCall }}>
      {children}
      {call ? (
        <CallOverlay
          call={call}
          localStream={localStream}
          remoteStream={remoteStream}
          audioMuted={audioMuted}
          cameraEnabled={cameraEnabled}
          onAccept={() => void acceptCall()}
          onReject={() => sendTerminalSignal("call:reject")}
          onEnd={() => sendTerminalSignal("call:end")}
          onToggleAudio={toggleAudio}
          onToggleCamera={toggleCamera}
        />
      ) : null}
      {callError ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-[110] mx-auto max-w-lg rounded-2xl border border-red-300/20 bg-[#1a1114]/95 px-4 py-3 text-sm text-red-100 shadow-2xl"
        >
          {callError}
        </div>
      ) : null}
    </CallContext.Provider>
  );
}

export function useCallControls() {
  const context = useContext(CallContext);
  if (!context) throw new Error("Call controls must be used inside CallProvider.");
  return context;
}

function CallOverlay({
  call,
  localStream,
  remoteStream,
  audioMuted,
  cameraEnabled,
  onAccept,
  onReject,
  onEnd,
  onToggleAudio,
  onToggleCamera,
}: {
  call: CallView;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audioMuted: boolean;
  cameraEnabled: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleAudio: () => void;
  onToggleCamera: () => void;
}) {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  const incoming = call.direction === "incoming" && call.phase === "ringing";
  const connectingLabel = call.direction === "outgoing" && call.phase === "ringing"
    ? "Calling…"
    : call.phase === "active"
      ? "Connected"
      : "Connecting…";
  const initials = (call.peer.displayName ?? call.peer.username)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={`${incoming ? "Incoming" : call.phase === "active" ? "Active" : "Outgoing"} ${call.mode} call with ${call.peer.displayName ?? call.peer.username}`}
      className="fixed inset-3 z-[100] mx-auto flex max-h-[calc(100dvh-1.5rem)] max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#101114]/95 shadow-[0_32px_120px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:inset-8 sm:max-h-[calc(100dvh-4rem)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{call.peer.displayName ?? call.peer.username}</p>
          <p className="text-xs text-white/50">
            {incoming
              ? `Incoming ${call.mode} call`
              : `${connectingLabel} · @${call.peer.username}`}
          </p>
        </div>
        {!incoming ? (
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">
            {call.mode === "video" ? "Video call" : "Voice call"}
          </span>
        ) : null}
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_30%,rgba(216,178,110,0.12),transparent_58%),#090a0d]">
        {call.mode === "video" ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <video ref={remoteVideoRef} autoPlay playsInline className="sr-only" />
        )}
        {call.mode === "audio" || !remoteStream?.getVideoTracks().some((track) => track.readyState === "live") ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-28 items-center justify-center rounded-full border border-white/15 bg-white/10 text-3xl font-semibold text-white/85 shadow-[0_0_80px_rgba(216,178,110,0.12)]">
              {initials}
            </div>
            <p className="text-sm text-white/55">
              {incoming ? "Answer to connect" : connectingLabel}
            </p>
          </div>
        ) : null}
        {call.mode === "video" && localStream?.getVideoTracks().length ? (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className={`absolute bottom-4 right-4 aspect-video w-[min(34%,14rem)] rounded-2xl border border-white/20 bg-black/50 object-cover shadow-xl ${
              cameraEnabled ? "" : "invisible"
            }`}
          />
        ) : null}
        {call.mode === "video" && !localStream?.getVideoTracks().length ? (
          <video ref={localVideoRef} autoPlay muted playsInline className="sr-only" />
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 px-4 py-4">
        {incoming ? (
          <>
            <Button type="button" className="gap-2" onClick={onAccept}>
              <Phone aria-hidden="true" className="size-4" />
              Answer
            </Button>
            <Button type="button" className="gap-2 bg-red-600 hover:bg-red-500" onClick={onReject}>
              <PhoneOff aria-hidden="true" className="size-4" />
              Decline
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={audioMuted ? "Unmute microphone" : "Mute microphone"}
              disabled={!localStream}
              onClick={onToggleAudio}
            >
              {audioMuted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
            </Button>
            {call.mode === "video" ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                disabled={!localStream}
                onClick={onToggleCamera}
              >
                {cameraEnabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}
              </Button>
            ) : null}
            <Button
              type="button"
              className="gap-2 bg-red-600 hover:bg-red-500"
              onClick={onEnd}
            >
              <PhoneOff aria-hidden="true" className="size-4" />
              End call
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
