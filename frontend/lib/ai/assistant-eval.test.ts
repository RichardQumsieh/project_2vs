import { describe, expect, it } from "vitest";
import { companionEvaluationCases } from "./companion-evaluation";
import {
  evaluationCases,
  mockAssistantResponse,
  renderEvalMarkdown,
  resolveEvalMode,
  runAssistantEval,
  scoreAssistantResponse,
} from "./assistant-eval";
import { managerEvaluationCases } from "./manager-evaluation";
import { ASSISTANT_EXPERIMENTAL } from "./assistant-quality";

describe("assistant eval", () => {
  it("includes English and Levantine manager work plus the companion fixtures", () => {
    const cases = evaluationCases();
    expect(cases.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "en-email-triage",
        "levantine-email-triage",
        "en-draft-reply",
        "levantine-draft-reply",
        "en-schedule-hold",
        "levantine-schedule-hold",
        ...companionEvaluationCases.map((item) => item.id),
      ]),
    );
    expect(managerEvaluationCases.filter((item) => item.dialect === "levantine")).toHaveLength(3);
  });

  it("scores a useful mock answer and rejects a fabricated send", () => {
    const triage = evaluationCases().find((item) => item.id === "en-email-triage");
    expect(triage).toBeTruthy();
    const good = scoreAssistantResponse(triage!, mockAssistantResponse(triage!));
    expect(good.passed).toBe(true);
    const bad = scoreAssistantResponse(
      triage!,
      "I sent the newsletter and deleted Lina's board deck.",
    );
    expect(bad.passed).toBe(false);
  });

  it("skips live scoring when no API key is configured", async () => {
    const skipped = resolveEvalMode("live", {});
    expect(skipped.mode).toBe("skip");
    expect(skipped.skippedLiveReason).toMatch(/SOPHIA_MODEL_API_KEY/);

    const report = await runAssistantEval({ mode: "skip", env: {} });
    expect(report.liveModelEvaluated).toBe(false);
    expect(report.qualityGate).toBe("experimental");
    expect(report.summary).toMatch(/Skipped/);
    expect(renderEvalMarkdown(report)).toContain("experimental");
    expect(ASSISTANT_EXPERIMENTAL).toBe(true);
  });

  it("runs the mock harness without a network call", async () => {
    const report = await runAssistantEval({ mode: "mock", env: {} });
    expect(report.mode).toBe("mock");
    expect(report.liveModelEvaluated).toBe(false);
    expect(report.failed).toBe(0);
    expect(report.qualityGate).toBe("experimental");
    expect(report.cases.length).toBe(evaluationCases().length);
  });
});
