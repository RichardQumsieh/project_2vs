import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_QUALITY_THRESHOLD,
  renderEvalMarkdown,
  runAssistantEval,
  type EvalMode,
} from "../lib/ai/assistant-eval";

function readMode(argv: string[]): EvalMode {
  const flag = argv.find((arg) => arg.startsWith("--mode="));
  const value = flag?.slice("--mode=".length) ?? process.env.ASSISTANT_EVAL_MODE ?? "auto";
  if (value === "mock" || value === "live" || value === "real" || value === "skip" || value === "auto") {
    return value;
  }
  throw new Error(`Unknown eval mode "${value}". Use mock, live, real, skip, or auto.`);
}

async function main() {
  const mode = readMode(process.argv.slice(2));
  const report = await runAssistantEval({ mode });
  const markdown = renderEvalMarkdown(report);
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "reports");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "assistant-eval.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(directory, "assistant-eval.md"), markdown);
  if (report.mode === "real" && report.qualityGate === "pass") {
    const recordPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "lib",
      "ai",
      "assistant-quality-record.json",
    );
    await writeFile(recordPath, `${JSON.stringify({
      passed: true,
      average: report.average,
      threshold: LIVE_QUALITY_THRESHOLD,
      mode: "real",
      recordedAt: report.generatedAt,
    }, null, 2)}\n`);
  }
  process.stdout.write(`${markdown}\n`);

  if ((report.mode === "live" || report.mode === "real") && report.qualityGate !== "pass") {
    process.exitCode = 1;
  }
}

void main();
