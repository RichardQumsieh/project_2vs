import { describe, expect, it } from "vitest";
import { assertDtlsSrtp, directInviteSignal, groupOfferSignal, shouldCreateGroupOffer } from "./call-media";

const sdp = [
  "v=0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=fingerprint:sha-256 AA:BB",
  "a=setup:actpass",
].join("\r\n");

describe("call signaling builders", () => {
  it("refuses a description that is not DTLS-SRTP", () => {
    expect(() => assertDtlsSrtp("v=0\r\nm=audio 9 RTP/AVP 111")).toThrow(/DTLS-SRTP/);
    expect(() => assertDtlsSrtp("m=audio 9 UDP/TLS/RTP/SAVPF 111")).toThrow(/fingerprint/);
  });

  it("builds authenticated direct and group signals from an encrypted offer", () => {
    const invite = directInviteSignal({
      callId: "e8cfa520-3e79-40db-9d85-497a1bdc9917",
      conversationId: "cc1bebdc-bf72-47fd-a15b-4c357d01b220",
      mode: "video",
      offer: { type: "offer", sdp },
    });
    expect(invite.type).toBe("call:invite");
    expect(invite.offer.sdp).toContain("fingerprint");
    const group = groupOfferSignal({
      callId: invite.callId,
      conversationId: invite.conversationId,
      peerId: "6d5f1c2a-0b34-4f0e-9a1c-2b7e5d8c4a11",
      offer: { type: "offer", sdp },
    });
    expect(group.peerId).toBe("6d5f1c2a-0b34-4f0e-9a1c-2b7e5d8c4a11");
    expect(shouldCreateGroupOffer("aaa", "bbb")).toBe(true);
    expect(shouldCreateGroupOffer("bbb", "aaa")).toBe(false);
  });
});
