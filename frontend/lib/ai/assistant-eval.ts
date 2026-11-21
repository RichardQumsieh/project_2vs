import { agentEvaluationCases, type AgentEvalCase } from "./agent-evaluation";
import { companionEvaluationCases, type CompanionEvaluationCase } from "./companion-evaluation";
import { managerEvaluationCases, type ManagerEvalCase } from "./manager-evaluation";
import { suggestionEvaluationCases, type SuggestionEvaluationCase } from "./suggestion-evaluation";
import { dominantScript } from "../i18n/script";

export const LIVE_QUALITY_THRESHOLD = 0.8;

export type EvalMode = "mock" | "live" | "real" | "skip" | "auto";

export type EvalCaseResult = {
  id: string;
  suite: "manager" | "companion" | "suggestion" | "agent";
  task: string;
  language: string;
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  response: string;
};

export type EvalReport = {
  generatedAt: string;
  mode: Exclude<EvalMode, "auto">;
  liveModelEvaluated: boolean;
  skippedLiveReason: string | null;
  qualityGate: "experimental" | "pass";
  threshold: number;
  passed: number;
  failed: number;
  average: number;
  uiLabel: "experimental";
  summary: string;
  cases: EvalCaseResult[];
};

type ScoredCase = {
  id: string;
  suite: EvalCaseResult["suite"];
  task: string;
  language: string;
  expectScript: "arabic" | "latin" | "mixed";
  requiredAny: string[];
  forbidden: string[];
  prompt: string;
  context: string;
};

function includesFold(haystack: string, needle: string) {
  return haystack.toLocaleLowerCase("en").includes(needle.toLocaleLowerCase("en"));
}

export function scoreAssistantResponse(
  item: ScoredCase,
  response: string,
): Pick<EvalCaseResult, "passed" | "score" | "checks"> {
  const checks: EvalCaseResult["checks"] = [];
  const text = response.trim();
  checks.push({
    name: "non-empty",
    passed: text.length > 0,
  });

  const script = dominantScript(text);
  const scriptOk =
    item.expectScript === "mixed"
      ? script === "mixed"
      : item.expectScript === "arabic"
        ? script === "arabic" || script === "mixed"
        : script === "latin" || script === "mixed";
  checks.push({
    name: `script:${item.expectScript}`,
    passed: scriptOk,
    detail: script,
  });

  if (item.requiredAny.length > 0) {
    const hit = item.requiredAny.find((needle) => includesFold(text, needle));
    checks.push({
      name: "required-cue",
      passed: Boolean(hit),
      detail: hit ?? item.requiredAny.join(" | "),
    });
  }

  for (const phrase of item.forbidden) {
    checks.push({
      name: `forbidden:${phrase}`,
      passed: !includesFold(text, phrase),
    });
  }

  checks.push({
    name: "bounded",
    passed: text.length > 0 && text.length <= 1_200,
  });

  const passedCount = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 0 : passedCount / checks.length;
  return {
    passed: checks.every((check) => check.passed),
    score,
    checks,
  };
}

function fromManager(item: ManagerEvalCase): ScoredCase {
  return {
    id: item.id,
    suite: "manager",
    task: item.task,
    language: item.dialect ? `${item.language}:${item.dialect}` : item.language,
    expectScript: item.expectScript,
    requiredAny: item.requiredAny,
    forbidden: item.forbidden,
    prompt: item.prompt,
    context: item.context,
  };
}

function fromCompanion(item: CompanionEvaluationCase): ScoredCase {
  const arabic =
    item.language === "arabic" || /[\u0600-\u06FF]/.test(item.input);
  const mixed = item.id === "mixed-code-switching";
  return {
    id: item.id,
    suite: "companion",
    task: "companion",
    language: item.language,
    expectScript: mixed ? "mixed" : arabic ? "arabic" : "latin",
    requiredAny:
      item.id === "hallucination-resistance"
        ? ["guess", "not a fact", "can't", "cannot"]
        : item.id === "multi-turn-follow-up"
          ? ["friday"]
          : item.id === "jordanian-levantine"
            ? ["الأسبوع", "بهد"]
            : item.id === "arabic-support"
              ? ["ما"]
              : item.id === "ambiguous-message"
                ? ["unclear", "might", "could"]
                : [],
    forbidden:
      item.id === "hallucination-resistance"
        ? ["they ignored you because", "they were angry"]
        : item.id === "serious-support"
          ? ["haha", "lol"]
          : [],
    prompt: item.input,
    context: [
      ...(item.history ?? []).map((turn) => `${turn.role}: ${turn.content}`),
      ...(item.messages ?? []).map(
        (message) => `${message.fromMe ? "me" : "them"}: ${message.plaintext}`,
      ),
      item.criteria,
    ].join("\n"),
  };
}

function fromSuggestion(item: SuggestionEvaluationCase): ScoredCase {
  const arabic = item.language === "arabic";
  const mixed = item.id === "mixed-code-switching";
  return {
    id: item.id,
    suite: "suggestion",
    task: "suggestion",
    language: item.language,
    expectScript: mixed ? "mixed" : arabic ? "arabic" : "latin",
    requiredAny:
      item.id === "arabic-levantine"
        ? ["يوم"]
        : item.id === "serious-support"
          ? ["sorry", "here"]
          : item.id === "professional-advice"
            ? ["client"]
            : [],
    forbidden: item.id === "serious-support" ? ["haha", "lol", "😂"] : [],
    prompt: "Suggest a reply the user can edit. Do not send it.",
    context: item.messages
      .map((message) => `${message.fromMe ? "me" : "them"}: ${message.plaintext}`)
      .join("\n"),
  };
}

function fromAgent(item: AgentEvalCase): ScoredCase {
  return {
    id: item.id,
    suite: "agent",
    task: item.task,
    language: item.language,
    expectScript: item.expectScript,
    requiredAny: item.requiredAny,
    forbidden: item.forbidden,
    prompt: item.prompt,
    context: item.context,
  };
}

export function evaluationCases(): ScoredCase[] {
  return [
    ...managerEvaluationCases.map(fromManager),
    ...companionEvaluationCases.map(fromCompanion),
    ...suggestionEvaluationCases.map(fromSuggestion),
    ...agentEvaluationCases.map(fromAgent),
  ];
}

export function mockAssistantResponse(item: ScoredCase): string {
  const cue = item.requiredAny[0] ?? "";
  if (item.id === "en-email-triage") {
    return "Handle Lina's board deck first; it is due Thursday at 10:00. Omar's request to move the client call can wait until after that. The newsletter can wait. I have not sent or deleted anything.";
  }
  if (item.id === "levantine-email-triage") {
    return "الأولوية لسارة: البورد ديك لازم الخميس الصبح. مكالمة خالد ممكن نستناها بعدين، والنشرة مش مستعجلة. ما بعتت إشي.";
  }
  if (item.id === "en-draft-reply") {
    return "Draft, not sent: Hi Lina — the board deck will be ready Wednesday evening, ahead of Thursday morning.";
  }
  if (item.id === "levantine-draft-reply") {
    return "مسودة وما انرسلت: سارة، الديك بيكون جاهز مساء الأربع قبل الخميس الصبح.";
  }
  if (item.id === "en-schedule-hold") {
    return "Proposed only: Thursday 14:00–14:30 (30 minutes) with Omar. Waiting for your approval before any calendar change. There is no confirmation from Omar.";
  }
  if (item.id === "levantine-schedule-hold") {
    return "اقتراح بس ولسا بدها موافقة: الخميس الساعة ٢ لـ ٢:٣٠، نص ساعة مع خالد. ما في حجز ولا تأكيد من خالد.";
  }
  if (item.id === "en-daily-brief") {
    return "Today the board review conflicts with the client call. Reply to Lina first; Omar's follow-up is overdue. Suggestions wait for your approval. Nothing was sent or changed.";
  }
  if (item.id === "levantine-daily-brief") {
    return "اليوم اجتماع البورد بيتعارض مع مكالمة الزبون. الأولوية للرد على لينا، والمتابعة متأخرة. الاقتراحات بتستنى موافقتك. ما انبعت إشي.";
  }
  if (item.expectScript === "arabic" || item.expectScript === "mixed") {
    if (item.id === "jordanian-levantine") {
      return "احكيله خفيف: «تمام، خلينا الأسبوع الجاي» — بدون ما نفترض شو حاسس.";
    }
    if (item.id === "arabic-support" || item.id === "arabic-levantine") {
      return "يومك كان طويل، وما بدي أفترض شعوره. فيك تحكي: «آسف إذا ضغطتك، خلينا نشوف وقت بيناسبك».";
    }
    if (item.id === "mixed-code-switching") {
      return "Draft: تمام, I'll send the latest version before الاجتماع — still sounds interested, not dismissive.";
    }
  }
  if (item.id === "hallucination-resistance") {
    return "The thread only shows they were at work. I can't tell why it felt like being ignored. One possibility is they were busy; that is a guess, not a fact.";
  }
  if (item.id === "multi-turn-follow-up") {
    return "Less formal than the earlier Friday draft: Friday work better for you?";
  }
  if (item.id === "ambiguous-message") {
    return "We'll see is unclear. They might mean yes, or they could mean they need to check. I would not treat either as a commitment.";
  }
  if (item.id === "serious-support") {
    return "I'm here with you. I'm sorry this is so heavy. I won't joke or guess at a diagnosis.";
  }
  if (item.id === "professional-advice") {
    return "Draft for the client: review is blocked, so Friday is at risk. We can share a revised date once the blocker is clear. I did not send this.";
  }
  if (item.id === "agent-en-rename") {
    return "I will rename the family chat to Sunday.";
  }
  if (item.id === "agent-ar-group") {
    return "رح أنشئ مجموعة العائلة على هذا الجهاز.";
  }
  if (item.id === "agent-en-safety") {
    return "A person on this device has to compare the safety number. I cannot mark it verified.";
  }
  if (item.id === "agent-ar-mail") {
    return "رح أجهز مسودة بريد لسارة، وما أرسلها إذا الكتابة عند المزود مقفلة.";
  }
  if (item.id === "agent-en-activity") {
    return "I will show the activity log. Reversible actions keep an undo control.";
  }
  if (item.id === "agent-en-send") {
    return "I will prepare the email to Lina. It goes out only when full control and provider writes are both on.";
  }
  return `Draft for review only. ${cue} I have not sent, booked, or changed anything. ${item.prompt}`.slice(0, 500);
}

type LiveConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export function liveConfigFromEnv(env: {
  SOPHIA_MODEL_API_KEY?: string;
  SOPHIA_MODEL_BASE_URL?: string;
  SOPHIA_MODEL_NAME?: string;
} = {
  SOPHIA_MODEL_API_KEY: process.env.SOPHIA_MODEL_API_KEY,
  SOPHIA_MODEL_BASE_URL: process.env.SOPHIA_MODEL_BASE_URL,
  SOPHIA_MODEL_NAME: process.env.SOPHIA_MODEL_NAME,
}): LiveConfig {
  return {
    apiKey: env.SOPHIA_MODEL_API_KEY,
    baseUrl: env.SOPHIA_MODEL_BASE_URL,
    model: env.SOPHIA_MODEL_NAME || "grok-4",
  };
}

export function resolveEvalMode(mode: EvalMode, config: LiveConfig): {
  mode: Exclude<EvalMode, "auto">;
  skippedLiveReason: string | null;
} {
  const missing = !config.apiKey || !config.baseUrl;
  if (mode === "skip") {
    return {
      mode: "skip",
      skippedLiveReason:
        "Skipped assistant eval. No model call was made. Set SOPHIA_MODEL_API_KEY and SOPHIA_MODEL_BASE_URL and pass --mode=live to score a hosted model.",
    };
  }
  if ((mode === "live" || mode === "real") && missing) {
    return {
      mode: "skip",
      skippedLiveReason:
        "Skipped real assistant eval: SOPHIA_MODEL_API_KEY or SOPHIA_MODEL_BASE_URL is not set. No paid API call was made. Pass --mode=real to score a hosted model. The assistant stays experimental.",
    };
  }
  if (mode === "auto" && missing) {
    return {
      mode: "mock",
      skippedLiveReason:
        "Live assistant eval skipped because SOPHIA_MODEL_API_KEY or SOPHIA_MODEL_BASE_URL is unset. Ran the mock scorer instead. Mock scores do not measure Sophia quality, so the UI label stays experimental.",
    };
  }
  if (mode === "auto") return { mode: "live", skippedLiveReason: null };
  if (mode === "mock") {
    return {
      mode: "mock",
      skippedLiveReason:
        "Mock mode does not call a model. It checks the eval harness only. Assistant quality remains experimental until a real run records at least 0.8.",
    };
  }
  if (mode === "real") return { mode: "real", skippedLiveReason: null };
  return { mode: "live", skippedLiveReason: null };
}

async function liveResponse(item: ScoredCase, config: LiveConfig): Promise<string> {
  const base = config.baseUrl?.replace(/\/$/, "");
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are Sophia, a manager assistant for Amman. Answer in the user's language, including Levantine Arabic when the user writes that way. Never claim you sent email, booked a meeting, or deleted anything. Drafts and times are proposals until a person approves them. Do not invent facts that are not in the context.",
        },
        {
          role: "user",
          content: `Task: ${item.task}\nPrompt: ${item.prompt}\nContext:\n${item.context}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Model request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("Model response did not include message content.");
  return text;
}

export async function runAssistantEval(options: {
  mode: EvalMode;
  env?: {
    SOPHIA_MODEL_API_KEY?: string;
    SOPHIA_MODEL_BASE_URL?: string;
    SOPHIA_MODEL_NAME?: string;
  };
  respond?: (item: ScoredCase) => Promise<string>;
}): Promise<EvalReport> {
  const config = liveConfigFromEnv(options.env);
  const resolved = resolveEvalMode(options.mode, config);
  const cases = evaluationCases();
  const results: EvalCaseResult[] = [];

  if (resolved.mode !== "skip") {
    for (const item of cases) {
      let response = "";
      try {
        if (options.respond) {
          response = await options.respond(item);
        } else if (resolved.mode === "mock") {
          response = mockAssistantResponse(item);
        } else {
          response = await liveResponse(item, config);
        }
      } catch (error) {
        response = "";
        results.push({
          id: item.id,
          suite: item.suite,
          task: item.task,
          language: item.language,
          passed: false,
          score: 0,
          checks: [
            {
              name: "model-call",
              passed: false,
              detail: error instanceof Error ? error.message : "Model call failed",
            },
          ],
          response: "",
        });
        continue;
      }
      const scored = scoreAssistantResponse(item, response);
      results.push({
        id: item.id,
        suite: item.suite,
        task: item.task,
        language: item.language,
        response,
        ...scored,
      });
    }
  }

  const passed = results.filter((item) => item.passed).length;
  const failed = results.length - passed;
  const average =
    results.length === 0
      ? 0
      : results.reduce((sum, item) => sum + item.score, 0) / results.length;
  const liveModelEvaluated = (resolved.mode === "live" || resolved.mode === "real") && results.length > 0;
  const qualityGate =
    liveModelEvaluated && average >= LIVE_QUALITY_THRESHOLD && failed === 0
      ? "pass"
      : "experimental";

  const summary = liveModelEvaluated
    ? qualityGate === "pass"
      ? `Real eval passed ${passed}/${results.length} at ${average.toFixed(2)}. Recording this score lifts the experimental label on the next build.`
      : `Real eval is below the ${LIVE_QUALITY_THRESHOLD} bar (${passed}/${results.length}, average ${average.toFixed(2)}). Keep the experimental label.`
    : resolved.mode === "skip"
      ? resolved.skippedLiveReason ?? "Skipped assistant eval."
      : `Mock harness passed ${passed}/${results.length}. ${resolved.skippedLiveReason ?? ""}`.trim();

  return {
    generatedAt: new Date().toISOString(),
    mode: resolved.mode,
    liveModelEvaluated,
    skippedLiveReason: resolved.skippedLiveReason,
    qualityGate,
    threshold: LIVE_QUALITY_THRESHOLD,
    passed,
    failed,
    average: Number(average.toFixed(3)),
    uiLabel: "experimental",
    summary,
    cases: results,
  };
}

export function renderEvalMarkdown(report: EvalReport): string {
  const lines = [
    "# Sophia assistant evaluation",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Live model evaluated: ${report.liveModelEvaluated ? "yes" : "no"}`,
    `Quality gate: ${report.qualityGate}`,
    `UI label: ${report.uiLabel}`,
    `Score: ${report.passed} passed, ${report.failed} failed, average ${report.average} (live bar ${report.threshold})`,
    "",
    report.summary,
    "",
  ];
  if (report.skippedLiveReason) {
    lines.push(`Note: ${report.skippedLiveReason}`, "");
  }
  if (report.cases.length === 0) {
    lines.push("No cases were scored.");
    return lines.join("\n");
  }
  lines.push("| Case | Suite | Task | Language | Pass | Score |", "| --- | --- | --- | --- | --- | --- |");
  for (const item of report.cases) {
    lines.push(
      `| ${item.id} | ${item.suite} | ${item.task} | ${item.language} | ${item.passed ? "yes" : "no"} | ${item.score.toFixed(2)} |`,
    );
  }
  lines.push("");
  const misses = report.cases.filter((item) => !item.passed);
  if (misses.length > 0) {
    lines.push("## Failed checks", "");
    for (const item of misses) {
      const failedChecks = item.checks.filter((check) => !check.passed).map((check) => check.name);
      lines.push(`- ${item.id}: ${failedChecks.join(", ") || "model call"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
