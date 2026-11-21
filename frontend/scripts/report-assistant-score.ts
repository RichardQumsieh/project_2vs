import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import record from "../lib/ai/assistant-quality-record.json";

async function main() {
  const reportPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "reports",
    "assistant-eval.json",
  );
  type ScoreReport = {
    mode?: string;
    average?: number;
    qualityGate?: string;
    passed?: number;
    failed?: number;
    threshold?: number;
    summary?: string;
  };
  let report: ScoreReport | null = null;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8")) as ScoreReport;
  } catch {
    report = null;
  }
  const lines = [
    `latestReport: ${report ? "yes" : "no"}`,
    `mode: ${report?.mode ?? "none"}`,
    `average: ${report?.average ?? "none"}`,
    `qualityGate: ${report?.qualityGate ?? "none"}`,
    `passed: ${report?.passed ?? "none"}`,
    `failed: ${report?.failed ?? "none"}`,
    `threshold: ${report?.threshold ?? record.threshold}`,
    `recordedPassed: ${record.passed}`,
    `recordedAverage: ${record.average ?? "none"}`,
    `uiLabel: ${record.passed === true && typeof record.average === "number" && record.average >= 0.8 ? "cleared" : "experimental"}`,
  ];
  if (report?.summary) lines.push(`summary: ${report.summary}`);
  if (!report) {
    lines.push("Run npm run eval:assistant -- --mode=mock or --mode=real before reading a score.");
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

void main();
