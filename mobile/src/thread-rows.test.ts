import { describe, expect, it } from "vitest";
import type { LocalMessage } from "../../frontend/lib/crypto/types";
import { buildThreadRows, clusterSpacing, formatThreadDay } from "./thread-rows";

function message(id: string, createdAt: string, fromMe: boolean, sender = "a"): LocalMessage {
  return {
    id,
    logicalMessageId: id,
    conversationId: "c",
    senderDeviceId: "d",
    senderUserId: sender,
    fromMe,
    plaintext: id,
    createdAt,
  };
}

describe("thread rows", () => {
  const now = new Date(2026, 10, 27, 18, 0, 0);

  it("labels today and yesterday", () => {
    expect(formatThreadDay(new Date(2026, 10, 27, 12).toISOString(), now, "en")).toBe("Today");
    expect(formatThreadDay(new Date(2026, 10, 26, 12).toISOString(), now, "en")).toBe("Yesterday");
    expect(formatThreadDay(new Date(2026, 10, 27, 12).toISOString(), now, "ar")).toBe("اليوم");
    expect(formatThreadDay(new Date(2026, 10, 26, 12).toISOString(), now, "ar")).toBe("أمس");
  });

  it("groups consecutive messages from the same sender and inserts a date separator", () => {
    const rows = buildThreadRows([
      message("3", new Date(2026, 10, 27, 15, 6).toISOString(), true),
      message("1", new Date(2026, 10, 27, 15, 0).toISOString(), true),
      message("2", new Date(2026, 10, 27, 15, 2).toISOString(), true),
      message("4", new Date(2026, 10, 26, 9).toISOString(), false, "peer"),
    ], now, "en");
    expect(rows.map((row) => row.kind === "date" ? row.label : `${row.message.id}:${row.cluster}`)).toEqual([
      "Yesterday",
      "4:single",
      "Today",
      "1:first",
      "2:middle",
      "3:last",
    ]);
    expect(rows.find((row) => row.kind === "message" && row.message.id === "1")).toMatchObject({ showSender: false });
    expect(clusterSpacing("first")).toBe(2);
    expect(clusterSpacing("last")).toBe(10);
  });
});
