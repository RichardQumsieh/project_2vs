import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCView,
  mediaDevices,
  type MediaStreamTrack,
} from "react-native-webrtc";
import { encodeCallPayload } from "../../frontend/lib/chat-payload";
import { api, openSignalingSocket, type Conversation } from "./api";
import { deliverCallLog } from "./call-log-bridge";
import { assertDtlsSrtp, shouldCreateGroupOffer } from "./call-media";

const maxGroupCallParticipants = 4;

type Mode = "audio" | "video";
type Phase = "ringing" | "connecting" | "active";
type Person = { id: string; username: string; displayName: string | null };
type LiveCall = {
  callId: string;
  conversationId: string;
  mode: Mode;
  direction: "incoming" | "outgoing";
  phase: Phase;
  kind: "direct" | "group";
  title: string;
  peerId?: string;
  participants: Person[];
};
type Description = { type: "offer" | "answer"; sdp: string };
type Ice = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
type CallContextValue = {
  startCall: (conversation: Conversation, mode: Mode) => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function personName(person: { displayName?: string | null; username?: string }) {
  return person.displayName?.trim() || person.username || "Someone";
}

function description(value: unknown): Description | null {
  if (!isRecord(value) || (value.type !== "offer" && value.type !== "answer") || typeof value.sdp !== "string") return null;
  return { type: value.type, sdp: value.sdp };
}

function iceCandidate(value: unknown): Ice | null {
  if (!isRecord(value) || typeof value.candidate !== "string") return null;
  return {
    candidate: value.candidate,
    sdpMid: typeof value.sdpMid === "string" || value.sdpMid === null ? value.sdpMid : undefined,
    sdpMLineIndex: typeof value.sdpMLineIndex === "number" ? value.sdpMLineIndex : undefined,
  };
}

type InCall = {
  start: (setup: { media: "audio" | "video" }) => void;
  stop: () => void;
  setForceSpeakerphoneOn: (enabled: boolean) => void;
  setSpeakerphoneOn: (enabled: boolean) => void;
};

function inCallManager(): InCall | null {
  try {
    const loaded = require("react-native-incall-manager") as { default?: InCall } & InCall;
    return loaded.default ?? loaded;
  } catch {
    return null;
  }
}

async function setSpeaker(enabled: boolean) {
  const manager = inCallManager();
  try {
    manager?.setForceSpeakerphoneOn(enabled);
    manager?.setSpeakerphoneOn(enabled);
  } catch {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: !enabled,
    }).catch(() => undefined);
  }
}

export function useCallControls() {
  const value = useContext(CallContext);
  if (!value) throw new Error("Call controls are unavailable.");
  return value;
}

export function CallProvider({ cookie, userId, children }: { cookie: string; userId: string; children: React.ReactNode }) {
  const [call, setCall] = useState<LiveCall | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeakerOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [groupTiles, setGroupTiles] = useState<{ id: string; url: string }[]>([]);
  const callRef = useRef<LiveCall | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const directRef = useRef<RTCPeerConnection | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingLocalRef = useRef(new Map<string, Ice[]>());
  const pendingRemoteRef = useRef(new Map<string, Ice[]>());
  const localReadyRef = useRef(new Set<string>());
  const incomingOfferRef = useRef<Description | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const connectedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRef = useRef<(value: unknown) => void>(() => undefined);

  const updateCall = useCallback((next: LiveCall | null) => {
    callRef.current = next;
    setCall(next);
  }, []);

  const showError = useCallback((message: string) => {
    setError(message);
  }, []);

  const sendSignal = useCallback(async (signal: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      throw new Error("Call signaling is reconnecting. Please try again.");
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Could not connect to call signaling.")), 5000);
        const done = (ok: boolean) => {
          clearTimeout(timeout);
          if (ok) resolve();
          else reject(new Error("Could not connect to call signaling."));
        };
        socket.addEventListener("open", () => done(true), { once: true });
        socket.addEventListener("error", () => done(false), { once: true });
      });
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      throw new Error("Call signaling is unavailable. Please try again.");
    }
    socketRef.current.send(JSON.stringify(signal));
  }, []);

  const writeLog = useCallback(async (current: LiveCall, outcome: "completed" | "missed" | "declined" | "cancelled") => {
    const durationSeconds = outcome === "completed" && startedAtRef.current
      ? Math.max(0, (Date.now() - startedAtRef.current) / 1000)
      : 0;
    const plaintext = encodeCallPayload({
      callId: current.callId,
      mode: current.mode,
      outcome,
      durationSeconds,
      at: new Date().toISOString(),
    });
    await deliverCallLog(current.conversationId, plaintext).catch(() => undefined);
  }, []);

  const stopMedia = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    directRef.current?.close();
    directRef.current = null;
    for (const peer of peersRef.current.values()) peer.close();
    peersRef.current.clear();
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    pendingLocalRef.current.clear();
    pendingRemoteRef.current.clear();
    localReadyRef.current.clear();
    incomingOfferRef.current = null;
    startedAtRef.current = null;
    connectedRef.current = false;
    setLocalUrl(null);
    setRemoteUrl(null);
    setGroupTiles([]);
    setMuted(false);
    setCameraOn(true);
    try { inCallManager()?.stop(); } catch { /* native audio route is optional */ }
    updateCall(null);
  }, [updateCall]);

  const publishIce = useCallback(async (current: LiveCall, peerId: string | undefined, candidate: Ice) => {
    if (current.kind === "group") {
      if (!peerId) return;
      await sendSignal({
        type: "call:group-ice",
        callId: current.callId,
        conversationId: current.conversationId,
        peerId,
        candidate,
      });
      return;
    }
    await sendSignal({
      type: "call:ice",
      callId: current.callId,
      conversationId: current.conversationId,
      candidate,
    });
  }, [sendSignal]);

  const attachPeer = useCallback((connection: RTCPeerConnection, current: LiveCall, peerId?: string) => {
    const key = peerId ?? "direct";
    connection.onicecandidate = (event) => {
      const candidate = (event as { candidate?: RTCIceCandidate | null }).candidate?.toJSON();
      if (!candidate?.candidate) return;
      const ice = { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex };
      if (!localReadyRef.current.has(key)) {
        const queued = pendingLocalRef.current.get(key) ?? [];
        queued.push(ice);
        pendingLocalRef.current.set(key, queued);
        return;
      }
      void publishIce(current, peerId, ice).catch((cause: unknown) => {
        showError(cause instanceof Error ? cause.message : "Could not send a call network candidate.");
      });
    };
    connection.ontrack = (event) => {
      const trackEvent = event as { streams?: MediaStream[]; track?: MediaStreamTrack | null };
      const remote = trackEvent.streams?.[0] ?? (trackEvent.track ? new MediaStream([trackEvent.track]) : null);
      if (!remote) return;
      if (peerId) {
        setGroupTiles((tiles) => {
          const next = tiles.filter((tile) => tile.id !== peerId);
          return [...next, { id: peerId, url: remote.toURL() }];
        });
      } else {
        remoteStreamRef.current = remote;
        setRemoteUrl(remote.toURL());
      }
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        connectedRef.current = true;
        if (!startedAtRef.current) startedAtRef.current = Date.now();
        const latest = callRef.current;
        if (latest) updateCall({ ...latest, phase: "active" });
      } else if (connection.connectionState === "failed") {
        showError("Could not establish the call. Try another network or configure a TURN relay.");
      }
    };
  }, [publishIce, showError, updateCall]);

  const openStream = useCallback(async (mode: Mode) => {
    const stream = await mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    localStreamRef.current = stream;
    setLocalUrl(stream.toURL());
    const manager = inCallManager();
    try {
      manager?.start({ media: mode });
    } catch {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    }
    const speakerDefault = mode === "video";
    setSpeakerOn(speakerDefault);
    await setSpeaker(speakerDefault);
    return stream;
  }, []);

  const flushLocal = useCallback(async (current: LiveCall, peerId?: string) => {
    const key = peerId ?? "direct";
    localReadyRef.current.add(key);
    const queued = pendingLocalRef.current.get(key) ?? [];
    pendingLocalRef.current.delete(key);
    for (const candidate of queued) await publishIce(current, peerId, candidate);
  }, [publishIce]);

  const makePeer = useCallback(async (current: LiveCall, peerId?: string) => {
    const { iceServers } = await api.callIceServers();
    const stream = localStreamRef.current ?? await openStream(current.mode);
    const connection = new RTCPeerConnection({ iceServers });
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    attachPeer(connection, current, peerId);
    if (peerId) peersRef.current.set(peerId, connection);
    else directRef.current = connection;
    return connection;
  }, [attachPeer, openStream]);

  const finish = useCallback((current: LiveCall | null, outcome: "completed" | "missed" | "declined" | "cancelled" | null) => {
    if (current && outcome) void writeLog(current, outcome);
    stopMedia();
  }, [stopMedia, writeLog]);

  const scheduleMissed = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const latest = callRef.current;
      if (!latest || latest.direction !== "incoming") return;
      void sendSignal({
        type: latest.kind === "group" ? "call:group-leave" : "call:reject",
        callId: latest.callId,
        conversationId: latest.conversationId,
      }).catch(() => undefined);
      finish(latest, "missed");
    }, 40_000);
  }, [finish, sendSignal]);

  const negotiateGroup = useCallback(async (remoteId: string) => {
    const current = callRef.current;
    if (!current || current.kind !== "group" || remoteId === userId || peersRef.current.has(remoteId)) return;
    if (!shouldCreateGroupOffer(userId, remoteId)) {
      await makePeer(current, remoteId);
      return;
    }
    const connection = await makePeer(current, remoteId);
    const offer = await connection.createOffer({});
    await connection.setLocalDescription(offer);
    const local = connection.localDescription;
    if (!local?.sdp || local.type !== "offer") throw new Error("Could not create a group call offer.");
    assertDtlsSrtp(local.sdp);
    await sendSignal({
      type: "call:group-offer",
      callId: current.callId,
      conversationId: current.conversationId,
      peerId: remoteId,
      offer: { type: "offer", sdp: local.sdp },
    });
    await flushLocal(current, remoteId);
  }, [flushLocal, makePeer, sendSignal, userId]);

  const handleSignal = useCallback((value: unknown) => {
    if (!isRecord(value) || typeof value.type !== "string") return;
    if (value.type === "call:error" && typeof value.message === "string") {
      showError(value.message);
      return;
    }
    const current = callRef.current;
    if (value.type === "call:invite" && isRecord(value.peer) && typeof value.peer.id === "string") {
      const offer = description(value.offer);
      if (current || !offer || typeof value.callId !== "string" || typeof value.conversationId !== "string") {
        if (typeof value.callId === "string" && typeof value.conversationId === "string") {
          void sendSignal({ type: "call:reject", callId: value.callId, conversationId: value.conversationId }).catch(() => undefined);
        }
        return;
      }
      const peer = value.peer as Person;
      incomingOfferRef.current = offer;
      updateCall({
        callId: value.callId,
        conversationId: value.conversationId,
        mode: value.mode === "video" ? "video" : "audio",
        direction: "incoming",
        phase: "ringing",
        kind: "direct",
        title: personName(peer),
        peerId: peer.id,
        participants: [peer],
      });
      scheduleMissed();
      return;
    }
    if (value.type === "call:group-invite" && Array.isArray(value.participants)) {
      if (current || typeof value.callId !== "string" || typeof value.conversationId !== "string") return;
      const participants = value.participants.filter(isRecord).map((item) => ({
        id: String(item.id ?? ""),
        username: String(item.username ?? ""),
        displayName: typeof item.displayName === "string" ? item.displayName : null,
      })).filter((item) => item.id);
      const caller = participants.find((item) => item.id === value.senderId);
      updateCall({
        callId: value.callId,
        conversationId: value.conversationId,
        mode: value.mode === "video" ? "video" : "audio",
        direction: "incoming",
        phase: "ringing",
        kind: "group",
        title: caller ? personName(caller) : "Group call",
        participants,
      });
      scheduleMissed();
      return;
    }
    if (!current || value.callId !== current.callId || value.conversationId !== current.conversationId) return;
    if (value.type === "call:answer") {
      const answer = description(value.answer);
      if (!answer || !directRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      void directRef.current.setRemoteDescription(answer).then(async () => {
        const queued = pendingRemoteRef.current.get("direct") ?? [];
        pendingRemoteRef.current.delete("direct");
        for (const candidate of queued) await directRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
        updateCall({ ...current, phase: "connecting" });
      }).catch((cause: unknown) => showError(cause instanceof Error ? cause.message : "Could not connect the call."));
      return;
    }
    if (value.type === "call:ice") {
      const candidate = iceCandidate(value.candidate);
      if (!candidate) return;
      const connection = directRef.current;
      if (!connection?.remoteDescription) {
        const queued = pendingRemoteRef.current.get("direct") ?? [];
        queued.push(candidate);
        pendingRemoteRef.current.set("direct", queued);
        return;
      }
      void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => showError("A call network candidate could not be applied."));
      return;
    }
    if (value.type === "call:reject" || value.type === "call:end") {
      showError(value.type === "call:reject" ? "The call was declined." : "The call ended.");
      stopMedia();
      return;
    }
    if (value.type === "call:group-join" && typeof value.senderId === "string" && value.senderId !== userId) {
      void negotiateGroup(value.senderId).catch((cause: unknown) => {
        showError(cause instanceof Error ? cause.message : "Could not connect a group participant.");
      });
      return;
    }
    if ((value.type === "call:group-offer" || value.type === "call:group-answer") && typeof value.senderId === "string") {
      const remoteId = value.senderId;
      const sdp = description(value.type === "call:group-offer" ? value.offer : value.answer);
      if (!sdp) return;
      void (async () => {
        let connection = peersRef.current.get(remoteId);
        if (!connection) connection = await makePeer(current, remoteId);
        await connection.setRemoteDescription(sdp);
        const queued = pendingRemoteRef.current.get(remoteId) ?? [];
        pendingRemoteRef.current.delete(remoteId);
        for (const candidate of queued) await connection.addIceCandidate(new RTCIceCandidate(candidate));
        if (value.type === "call:group-offer") {
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          const local = connection.localDescription;
          if (!local?.sdp) throw new Error("Could not answer the group call.");
          assertDtlsSrtp(local.sdp);
          await sendSignal({
            type: "call:group-answer",
            callId: current.callId,
            conversationId: current.conversationId,
            peerId: remoteId,
            answer: { type: "answer", sdp: local.sdp },
          });
          await flushLocal(current, remoteId);
        }
      })().catch((cause: unknown) => showError(cause instanceof Error ? cause.message : "Could not connect the group call."));
      return;
    }
    if (value.type === "call:group-ice" && typeof value.senderId === "string") {
      const candidate = iceCandidate(value.candidate);
      if (!candidate) return;
      const connection = peersRef.current.get(value.senderId);
      if (!connection?.remoteDescription) {
        const queued = pendingRemoteRef.current.get(value.senderId) ?? [];
        queued.push(candidate);
        pendingRemoteRef.current.set(value.senderId, queued);
        return;
      }
      void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
      return;
    }
    if (value.type === "call:group-leave") {
      if (typeof value.senderId === "string") {
        peersRef.current.get(value.senderId)?.close();
        peersRef.current.delete(value.senderId);
        setGroupTiles((tiles) => tiles.filter((tile) => tile.id !== value.senderId));
      }
      if (value.ended === true) {
        showError("The group call ended.");
        stopMedia();
      }
    }
  }, [finish, flushLocal, makePeer, negotiateGroup, scheduleMissed, sendSignal, showError, stopMedia, updateCall, userId]);

  useEffect(() => { handleRef.current = handleSignal; }, [handleSignal]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (stopped) return;
      socket = openSignalingSocket();
      socketRef.current = socket;
      socket.onmessage = (event) => {
        try { handleRef.current(JSON.parse(String(event.data))); }
        catch { showError("Could not read a call signaling message."); }
      };
      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (event.code === 4401 || event.code === 4403) {
          stopped = true;
          stopMedia();
          if (event.code === 4401) showError("Your session expired. Sign in again to continue calling.");
          return;
        }
        if (!stopped) retry = setTimeout(connect, 1000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      stopMedia();
    };
  }, [cookie, showError, stopMedia, userId]);

  const startCall = useCallback(async (conversation: Conversation, mode: Mode) => {
    if (callRef.current) {
      showError("Finish the current call before starting another.");
      return;
    }
    setError("");
    const memberCount = conversation.members?.length ?? conversation.memberUserIds?.length ?? 0;
    if (conversation.type === "GROUP" && (memberCount < 2 || memberCount > maxGroupCallParticipants)) {
      showError(`Group calls support 2 to ${maxGroupCallParticipants} people.`);
      return;
    }
    if (conversation.type === "DIRECT" && !conversation.peer) {
      showError("This conversation has no one to call.");
      return;
    }
    const next: LiveCall = {
      callId: crypto.randomUUID(),
      conversationId: conversation.id,
      mode,
      direction: "outgoing",
      phase: "connecting",
      kind: conversation.type === "GROUP" ? "group" : "direct",
      title: conversation.type === "GROUP"
        ? conversation.title || "Group call"
        : personName(conversation.peer ?? { username: "Someone" }),
      peerId: conversation.peer?.id,
      participants: conversation.type === "GROUP"
        ? (conversation.members ?? []).map((member) => ({ id: member.userId, username: member.username, displayName: member.displayName }))
        : conversation.peer ? [conversation.peer] : [],
    };
    updateCall(next);
    try {
      await openStream(mode);
      if (next.kind === "group") {
        await sendSignal({ type: "call:group-invite", callId: next.callId, conversationId: next.conversationId, mode });
      } else {
        const connection = await makePeer(next);
        const offer = await connection.createOffer({});
        await connection.setLocalDescription(offer);
        const local = connection.localDescription;
        if (!local?.sdp || local.type !== "offer") throw new Error("Could not create a call offer.");
        assertDtlsSrtp(local.sdp);
        await sendSignal({
          type: "call:invite",
          callId: next.callId,
          conversationId: next.conversationId,
          mode,
          offer: { type: "offer", sdp: local.sdp },
        });
        await flushLocal(next);
      }
      updateCall({ ...next, phase: "ringing" });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const latest = callRef.current;
        if (!latest || latest.callId !== next.callId) return;
        void sendSignal({
          type: latest.kind === "group" ? "call:group-leave" : "call:end",
          callId: latest.callId,
          conversationId: latest.conversationId,
        }).catch(() => undefined);
        finish(latest, "cancelled");
      }, 45_000);
    } catch (cause) {
      finish(null, null);
      showError(cause instanceof Error ? cause.message : "Could not start the call.");
    }
  }, [finish, flushLocal, makePeer, openStream, sendSignal, showError, updateCall]);

  const accept = useCallback(async () => {
    const current = callRef.current;
    if (!current || current.direction !== "incoming") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    updateCall({ ...current, phase: "connecting" });
    try {
      await openStream(current.mode);
      if (current.kind === "group") {
        await sendSignal({ type: "call:group-join", callId: current.callId, conversationId: current.conversationId });
        for (const participant of current.participants) {
          if (participant.id !== userId) await negotiateGroup(participant.id);
        }
        return;
      }
      const offer = incomingOfferRef.current;
      if (!offer) throw new Error("The incoming call offer is missing.");
      const connection = await makePeer(current);
      await connection.setRemoteDescription(offer);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      const local = connection.localDescription;
      if (!local?.sdp) throw new Error("Could not create a call answer.");
      assertDtlsSrtp(local.sdp);
      await sendSignal({
        type: "call:answer",
        callId: current.callId,
        conversationId: current.conversationId,
        answer: { type: "answer", sdp: local.sdp },
      });
      await flushLocal(current);
    } catch (cause) {
      void sendSignal({
        type: current.kind === "group" ? "call:group-leave" : "call:reject",
        callId: current.callId,
        conversationId: current.conversationId,
      }).catch(() => undefined);
      finish(current, "declined");
      showError(cause instanceof Error ? cause.message : "Could not answer the call.");
    }
  }, [finish, flushLocal, makePeer, negotiateGroup, openStream, sendSignal, showError, updateCall, userId]);

  const decline = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    void sendSignal({
      type: current.kind === "group" ? "call:group-leave" : "call:reject",
      callId: current.callId,
      conversationId: current.conversationId,
    }).catch(() => undefined);
    finish(current, current.direction === "incoming" ? "declined" : "cancelled");
  }, [finish, sendSignal]);

  const end = useCallback(() => {
    const current = callRef.current;
    if (!current) return;
    const outcome = connectedRef.current || current.phase === "active" ? "completed" : "cancelled";
    void sendSignal({
      type: current.kind === "group" ? "call:group-leave" : "call:end",
      callId: current.callId,
      conversationId: current.conversationId,
    }).catch(() => undefined);
    finish(current, outcome);
  }, [finish, sendSignal]);

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }
  function toggleSpeaker() {
    const next = !speaker;
    setSpeakerOn(next);
    void setSpeaker(next);
  }
  function flipCamera() {
    localStreamRef.current?.getVideoTracks().forEach((track) => track._switchCamera());
  }
  function toggleCamera() {
    const next = !cameraOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraOn(next);
  }

  return (
    <CallContext.Provider value={{ startCall }}>
      {children}
      <Modal visible={Boolean(call)} animationType="slide" presentationStyle="fullScreen" onRequestClose={end}>
        {call ? (
          <View style={styles.root} accessibilityViewIsModal>
            <Text style={styles.title}>{call.title}</Text>
            <Text style={styles.subtitle}>
              {call.direction === "incoming" && call.phase === "ringing"
                ? `Incoming ${call.mode} call`
                : call.phase === "active" ? "Connected" : call.phase === "ringing" ? "Calling…" : "Connecting…"}
            </Text>
            <View style={styles.stage}>
              {call.mode === "video" && remoteUrl ? <RTCView streamURL={remoteUrl} style={styles.remote} objectFit="cover" /> : null}
              {groupTiles.map((tile) => <RTCView key={tile.id} streamURL={tile.url} style={styles.tile} objectFit="cover" />)}
              {call.mode === "video" && localUrl && cameraOn ? <RTCView streamURL={localUrl} style={styles.local} objectFit="cover" mirror /> : null}
              {call.mode === "audio" || (!remoteUrl && groupTiles.length === 0) ? <Ionicons name={call.mode === "video" ? "videocam" : "call"} size={42} color="#E8ECF5" /> : null}
            </View>
            <View style={styles.controls}>
              {call.direction === "incoming" && call.phase === "ringing" ? (
                <>
                  <Round icon="call" label="Answer" onPress={() => void accept()} />
                  <Round icon="close" label="Decline" danger onPress={decline} />
                </>
              ) : (
                <>
                  <Round icon={muted ? "mic-off" : "mic"} label={muted ? "Unmute" : "Mute"} onPress={toggleMute} />
                  <Round icon={speaker ? "volume-high" : "volume-medium"} label={speaker ? "Speaker on" : "Speaker"} onPress={toggleSpeaker} />
                  {call.mode === "video" ? <Round icon="camera-reverse" label="Flip camera" onPress={flipCamera} /> : null}
                  {call.mode === "video" ? <Round icon={cameraOn ? "videocam" : "videocam-off"} label={cameraOn ? "Camera on" : "Camera off"} onPress={toggleCamera} /> : null}
                  <Round icon="call" label="End" danger onPress={end} />
                </>
              )}
            </View>
          </View>
        ) : null}
      </Modal>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </CallContext.Provider>
  );
}

function Round({ icon, label, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.round, danger && styles.danger]}>
      <Ionicons name={icon} size={22} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#101114", paddingTop: 64, paddingHorizontal: 20, paddingBottom: 28 },
  title: { color: "#FFFFFF", fontSize: 28, fontFamily: "Georgia", textAlign: "center" },
  subtitle: { color: "#C8CDD8", textAlign: "center", marginTop: 8 },
  stage: { flex: 1, marginVertical: 20, borderRadius: 28, overflow: "hidden", backgroundColor: "#1A1D27", alignItems: "center", justifyContent: "center" },
  remote: { ...StyleSheet.absoluteFill },
  tile: { width: "48%", height: 180, margin: 4 },
  local: { position: "absolute", width: 110, height: 150, end: 16, bottom: 16, borderRadius: 16 },
  controls: { flexDirection: "row", justifyContent: "center", gap: 14 },
  round: { width: 62, height: 62, borderRadius: 31, backgroundColor: "#2A3142", alignItems: "center", justifyContent: "center" },
  danger: { backgroundColor: "#B42318" },
  error: { position: "absolute", left: 16, right: 16, bottom: 24, color: "#F8D0D0", textAlign: "center" },
});
