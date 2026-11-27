export function assertDtlsSrtp(sdp: string) {
  const profile = sdp.includes("UDP/TLS/RTP/SAVPF") || sdp.includes("UDP/TLS/RTP/SAVP");
  if (!profile) throw new Error("This call is not using encrypted DTLS-SRTP media.");
  if (!/a=fingerprint:/i.test(sdp)) throw new Error("This call is missing a DTLS fingerprint.");
}

export function shouldCreateGroupOffer(localUserId: string, remoteUserId: string) {
  return localUserId < remoteUserId;
}

type Description = { type: "offer" | "answer"; sdp: string };

export function directInviteSignal(input: {
  callId: string;
  conversationId: string;
  mode: "audio" | "video";
  offer: Description;
}) {
  if (input.offer.type !== "offer") throw new Error("A call invite needs an SDP offer.");
  assertDtlsSrtp(input.offer.sdp);
  return {
    type: "call:invite" as const,
    callId: input.callId,
    conversationId: input.conversationId,
    mode: input.mode,
    offer: input.offer,
  };
}

export function groupOfferSignal(input: {
  callId: string;
  conversationId: string;
  peerId: string;
  offer: Description;
}) {
  if (input.offer.type !== "offer") throw new Error("A group offer needs an SDP offer.");
  assertDtlsSrtp(input.offer.sdp);
  return {
    type: "call:group-offer" as const,
    callId: input.callId,
    conversationId: input.conversationId,
    peerId: input.peerId,
    offer: input.offer,
  };
}
