#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PERSONAS_DIR = process.env.CLAUDE_RESEARCH_PERSONAS_DIR || join(ROOT, "personas");
const DECISIONS_PATH = process.env.CLAUDE_RESEARCH_DECISIONS_PATH || join(ROOT, "policies", "research-decisions.md");
const CLAUDE_BIN = process.env.CLAUDE_RESEARCH_CLAUDE_BIN || "claude";
const DEFAULT_MODEL = process.env.CLAUDE_RESEARCH_MODEL || "opus";
const DEFAULT_EFFORT = process.env.CLAUDE_RESEARCH_EFFORT || "high";
const DEFAULT_MAX_WALL_TIME_MINUTES = Number.parseInt(
  process.env.CLAUDE_RESEARCH_MAX_WALL_TIME_MINUTES || "60",
  10,
);
const DEFAULT_MAX_TOOL_CALLS = Number.parseInt(
  process.env.CLAUDE_RESEARCH_MAX_TOOL_CALLS || "200",
  10,
);
const STATE_DIR = resolve(
  process.env.CLAUDE_RESEARCH_STATE_DIR || join(homedir(), ".codex", "claude-research", "jobs"),
);
const PHASES = ["implementation", "review", "execution", "interpretation"];
const PERSONAS_BY_PHASE = {
  implementation: ["implementer"],
  review: ["code-reviewer", "experiment-auditor", "measurement-auditor", "falsifier"],
  execution: ["implementer"],
  interpretation: ["results-interpreter"],
};
const APPROVAL_PHASES = new Set(["implementation", "execution"]);
const jobs = new Map();
const pluginManifest = JSON.parse(
  readFileSync(join(ROOT, ".codex-plugin", "plugin.json"), "utf8"),
);

const SERVER_INSTRUCTIONS = `Local Claude Code executor for trustworthy research. Never infer permission to use Claude from a request to implement, test, review, run, or interpret research. Every new Claude job requires a separate exact user quote that explicitly opts into Claude, claude-research, or delegate-to-claude. Discussion and experiment-contract agreement happen in Codex before any Claude job starts. Every job has an immutable workflow phase, an explicit project cwd, and a durable work_package_id. Implementation and execution additionally require exact phase-approval quotes, and they are separate approvals. Once a job is explicitly delegated, Codex has full operational authority over that Claude: it may cancel, redirect, restart, or continue workers without separate user approval. Worker control does not authorize a new experiment phase or repeat execution. Every persona receives the shared standing research decisions in addition to its role prompt. Poll each started job until terminal and inspect budget or policy warnings. Use reply to resume the same persisted Claude session for corrections and milestones; do not start a replacement implementer unless the prior native session is unrecoverable. An execution retry requires a new start and approval. Use fresh jobs for independent review. Opus runs locally with dangerous permissions. Codex should make targeted spot-checks of actual code and artifacts whenever they reduce uncertainty or wasted work.`;

const EXPLICIT_DELEGATION_PATTERN = /(?:\b(?:use|using|ask|have|let|start|approve|delegate)\b.{0,100}\bclaude\b|\bclaude\b.{0,100}\b(?:implement|review|audit|run|execute|interpret|work|delegate|approve)\b|claude-research|delegate-to-claude)/i;
const DELEGATION_REFUSAL_PATTERN = /(?:\b(?:do\s+not|don't|dont|never|no|without|avoid|stop|cancel)\b.{0,100}\bclaudes?\b|\bclaudes?\b.{0,100}\b(?:stop|cancel|not\s+authorized|not\s+approved)\b)/i;

function text(value) {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function personaSummary(markdown) {
  const lines = markdown.split("\n").map((line) => line.trim());
  const heading = lines.find((line) => line.startsWith("# "))?.slice(2);
  const firstParagraph = lines.find((line) => line && !line.startsWith("#"));
  return { title: heading || "Claude persona", summary: firstParagraph || "" };
}

function loadPersonas() {
  const entries = {};
  for (const filename of readdirSync(PERSONAS_DIR).sort()) {
    if (!filename.endsWith(".md")) continue;
    const name = filename.slice(0, -3);
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    const prompt = readFileSync(join(PERSONAS_DIR, filename), "utf8").trim();
    entries[name] = { name, prompt, ...personaSummary(prompt) };
  }
  return entries;
}

const personas = loadPersonas();
const standingDecisions = readFileSync(DECISIONS_PATH, "utf8").trim();
const promptBundleSha256 = createHash("sha256")
  .update(standingDecisions)
  .update(
    Object.values(personas)
      .map(({ name, prompt }) => `${name}\n${prompt}`)
      .join("\n"),
  )
  .digest("hex");
const runtime = {
  plugin_version: pluginManifest.version,
  mcp_protocol_version: PROTOCOL_VERSION,
  prompt_bundle_sha256: promptBundleSha256,
};

mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

function jobStatePath(jobId) {
  return join(STATE_DIR, `${jobId}.json`);
}

function jobEventLogPath(jobId) {
  return join(STATE_DIR, `${jobId}.events.jsonl`);
}

function serializableJob(job) {
  return {
    id: job.id,
    sessionId: job.sessionId,
    cwd: job.cwd,
    workPackageId: job.workPackageId,
    persona: job.persona,
    phase: job.phase,
    approvalQuote: job.approvalQuote,
    delegationApprovalQuote: job.delegationApprovalQuote,
    model: job.model,
    effort: job.effort,
    maxWallTimeMinutes: job.maxWallTimeMinutes,
    maxToolCalls: job.maxToolCalls,
    status: job.status,
    turn: job.turn,
    nextSeq: job.nextSeq,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    pendingResult: job.pendingResult,
    lastResult: job.lastResult,
    error: job.error,
    brief: job.brief,
    totalToolCalls: job.totalToolCalls,
    supersededBy: job.supersededBy,
    replacementFor: job.replacementFor,
  };
}

function persistJob(job) {
  const target = jobStatePath(job.id);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(serializableJob(job), null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, target);
  } catch (error) {
    process.stderr.write(`Failed to persist Claude job ${job.id}: ${error.message}\n`);
  }
}

function addEvent(job, kind, data = {}) {
  const event = {
    seq: job.nextSeq++,
    at: new Date().toISOString(),
    kind,
    ...data,
  };
  job.events.push(event);
  try {
    appendFileSync(jobEventLogPath(job.id), `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch (error) {
    process.stderr.write(`Failed to persist Claude event for ${job.id}: ${error.message}\n`);
  }
  job.updatedAt = event.at;
  for (const wake of job.waiters) wake();
  job.waiters.clear();
  persistJob(job);
  return event;
}

function claudeEnvironment() {
  const environment = { ...process.env };
  if (process.env.CLAUDE_RESEARCH_INHERIT_GLOBAL_PROMPT !== "1") {
    delete environment.CLAUDE_APPEND_SYSTEM_PROMPT;
  }
  return environment;
}

function bashCommand(input) {
  if (!input) return null;
  if (typeof input === "object" && typeof input.command === "string") return input.command;
  if (typeof input !== "string") return null;
  try {
    const parsed = JSON.parse(input);
    return typeof parsed?.command === "string" ? parsed.command : null;
  } catch {
    return null;
  }
}

function requestCancellation(job, reason, kind = "cancel_requested") {
  if (!job.process || job.status === "cancelling") return false;
  job.status = "cancelling";
  addEvent(job, kind, { reason });
  const child = job.process;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (job.process === child) child.kill("SIGKILL");
  }, 1_000);
  timer.unref();
  return true;
}

function observeToolUse(job, tool, input) {
  job.invocationToolCalls += 1;
  job.totalToolCalls += 1;

  if (
    !job.budgetWarningEmitted &&
    job.invocationToolCalls >= Math.max(1, Math.floor(job.maxToolCalls * 0.8))
  ) {
    job.budgetWarningEmitted = true;
    addEvent(job, "budget_warning", {
      budget: "tool_calls",
      used: job.invocationToolCalls,
      limit: job.maxToolCalls,
      action: "Ask the worker to checkpoint and finish the current milestone; cancel if it loops.",
    });
  }

  if (job.invocationToolCalls > job.maxToolCalls) {
    requestCancellation(
      job,
      `Automatic cancellation: this turn exceeded its ${job.maxToolCalls} tool-call budget.`,
      "budget_cancel_requested",
    );
    return;
  }

  if (tool !== "Bash") return;
  const command = bashCommand(input);
  if (!command) return;

  const normalized = command.replace(/\s+/g, " ").trim();
  const repetitions = (job.commandCounts.get(normalized) || 0) + 1;
  job.commandCounts.set(normalized, repetitions);
  if (repetitions === 3) {
    addEvent(job, "policy_warning", {
      policy: "repeated_command",
      command: normalized,
      occurrences: repetitions,
      message: "The same shell command has run three times in this turn; inspect for a loop before continuing.",
    });
  }

  const testRunner = /(?:^|[;&|(]\s*)(?:uv\s+run\s+)?(?:python\s+-m\s+)?(?:pytest|npm\s+test|cargo\s+test|go\s+test)\b/i;
  const outputFilter = /\|(?:&)?\s*(?:head|tail|grep|sed)\b/i;
  if (testRunner.test(command) && outputFilter.test(command)) {
    addEvent(job, "policy_warning", {
      policy: "masked_test_exit_status",
      command: normalized,
      message: "A test runner was piped through an output filter. Its exit status may be masked; rerun once without the pipeline and preserve the runner's exact exit code.",
    });
  }
}

function assistantEvents(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return [];
  const events = [];
  for (const block of blocks) {
    if (block?.type === "text" && block.text) {
      events.push({ kind: "assistant_text", text: text(block.text) });
    } else if (block?.type === "tool_use") {
      events.push({
        kind: "tool_use",
        tool: block.name || "unknown",
        input: text(block.input),
        rawInput: block.input,
      });
    }
  }
  return events;
}

function userEvents(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((block) => block?.type === "tool_result")
    .map((block) => ({
      kind: "tool_result",
      tool_use_id: block.tool_use_id,
      is_error: Boolean(block.is_error),
      content: text(block.content),
    }));
}

function consumeClaudeMessage(job, message) {
  if (message?.type === "system" && message.subtype === "thinking_tokens") {
    return;
  }

  if (message?.type === "system" && message.subtype === "init") {
    addEvent(job, "session_init", {
      session_id: message.session_id || job.sessionId,
      model: message.model || job.model,
      cwd: message.cwd || job.cwd,
    });
    return;
  }

  if (message?.type === "assistant") {
    for (const event of assistantEvents(message.message)) {
      const { kind, rawInput, ...data } = event;
      addEvent(job, kind, data);
      if (kind === "tool_use") observeToolUse(job, data.tool, rawInput);
    }
    return;
  }

  if (message?.type === "user") {
    for (const event of userEvents(message.message)) {
      const { kind, ...data } = event;
      addEvent(job, kind, data);
    }
    return;
  }

  if (message?.type === "result") {
    job.pendingResult = {
      is_error: Boolean(message.is_error),
      subtype: message.subtype,
      result: text(message.result),
      structured_output: message.structured_output,
      total_cost_usd: message.total_cost_usd,
      duration_ms: message.duration_ms,
      num_turns: message.num_turns,
      session_id: message.session_id || job.sessionId,
    };
    addEvent(job, "result", job.pendingResult);
    return;
  }

  if (message?.type && message.type !== "stream_event") {
    addEvent(job, "claude_event", { type: message.type, data: text(message) });
  }
}

function phaseInstructions(job) {
  const delegation = `CLAUDE DELEGATION APPROVAL: ${job.delegationApprovalQuote}`;
  if (job.phase === "implementation") {
    return `${delegation}\nWORKFLOW PHASE: implementation\nIMPLEMENTATION APPROVAL: ${job.approvalQuote}\nAUTHORIZED: implement the agreed contract and run focused tests or cheap smoke checks.\nFORBIDDEN: launch the full, expensive, or conclusion-bearing experiment. If such a run is needed, stop and report it to Codex.`;
  }
  if (job.phase === "review") {
    return `${delegation}\nWORKFLOW PHASE: review\nAUTHORIZED: inspect the implementation and artifacts and run focused checks.\nFORBIDDEN: edit tracked implementation files or launch the full experiment.`;
  }
  if (job.phase === "execution") {
    return `${delegation}\nWORKFLOW PHASE: execution\nEXECUTION APPROVAL: ${job.approvalQuote}\nAUTHORIZED: execute only the frozen, audited experiment contract and monitor it as specified.\nFORBIDDEN: change tracked experiment code or silently alter the contract. If a change is required, stop and report it to Codex.`;
  }
  return `${delegation}\nWORKFLOW PHASE: interpretation\nAUTHORIZED: inspect and analyze completed-run evidence and perform non-destructive recomputation.\nFORBIDDEN: edit tracked implementation files or launch a new experiment.`;
}

function buildPrompt(job, brief, continuation = false) {
  const framing = continuation
    ? "Codex is continuing your existing assignment. Treat the message below as review feedback or an additional request. Preserve the agreed experiment contract and explicitly report any requested change you cannot safely make."
    : "Codex has delegated this assignment after discussing the research direction with the user. Work autonomously in the local checkout. Do not silently resolve scientifically meaningful ambiguity: state assumptions and deviations. Inspect actual files and evidence, and finish with findings, commands run, failures, unresolved risks, and artifact paths.";
  return `${framing}\n\nWORK PACKAGE: ${job.workPackageId}\nPROJECT DIRECTORY: ${job.cwd}\nDURABLE JOB RECORD: ${jobStatePath(job.id)}\nKeep the final requirement ledger concise and current so another Codex or resumed Claude can recover the exact state without rediscovering the whole repository.\n\n${phaseInstructions(job)}\n\n${continuation ? "FOLLOW-UP" : "TASK BRIEF"}:\n${brief}`;
}

function claudeArgs(job, prompt, continuation) {
  const args = [
    "-p",
    buildPrompt(job, prompt, continuation),
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    job.model,
    "--effort",
    job.effort,
    "--dangerously-skip-permissions",
    "--append-system-prompt",
    `${standingDecisions}\n\n${personas[job.persona].prompt}`,
  ];
  if (continuation) args.push("--resume", job.sessionId);
  else args.push("--session-id", job.sessionId);
  return args;
}

function launch(job, prompt, continuation = false) {
  job.status = "running";
  job.pendingResult = null;
  job.turn += 1;
  job.invocationToolCalls = 0;
  job.commandCounts = new Map();
  job.budgetWarningEmitted = false;
  addEvent(job, continuation ? "reply_started" : "job_started", {
    turn: job.turn,
    persona: job.persona,
    phase: job.phase,
    model: job.model,
  });

  const child = spawn(CLAUDE_BIN, claudeArgs(job, prompt, continuation), {
    cwd: job.cwd,
    env: claudeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.process = child;
  persistJob(job);
  job.budgetTimer = setTimeout(() => {
    requestCancellation(
      job,
      `Automatic cancellation: this turn exceeded its ${job.maxWallTimeMinutes}-minute wall-time budget.`,
      "budget_cancel_requested",
    );
  }, job.maxWallTimeMinutes * 60_000);
  job.budgetTimer.unref();

  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    if (!line.trim()) return;
    try {
      consumeClaudeMessage(job, JSON.parse(line));
    } catch {
      addEvent(job, "unparsed_stdout", { text: text(line) });
    }
  });

  const stderr = createInterface({ input: child.stderr });
  stderr.on("line", (line) => {
    if (line.trim()) addEvent(job, "stderr", { text: text(line) });
  });

  child.on("error", (error) => {
    if (job.budgetTimer) clearTimeout(job.budgetTimer);
    job.budgetTimer = null;
    job.status = "failed";
    job.error = error.message;
    job.process = null;
    addEvent(job, "process_error", { error: error.message });
  });

  child.on("close", (code, signal) => {
    if (job.budgetTimer) clearTimeout(job.budgetTimer);
    job.budgetTimer = null;
    job.process = null;
    if (job.status === "cancelling") {
      job.status = "cancelled";
    } else if (job.pendingResult?.is_error || code !== 0) {
      job.status = "failed";
    } else {
      job.status = "completed";
    }
    job.lastResult = job.pendingResult;
    addEvent(job, "process_exit", { status: job.status, code, signal });
  });
}

function requireJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Unknown job_id: ${jobId}`);
  return job;
}

function publicJob(job) {
  return {
    job_id: job.id,
    session_id: job.sessionId,
    work_package_id: job.workPackageId,
    status: job.status,
    persona: job.persona,
    phase: job.phase,
    approval_quote: job.approvalQuote,
    delegation_approval_quote: job.delegationApprovalQuote,
    model: job.model,
    effort: job.effort,
    cwd: job.cwd,
    state_file: jobStatePath(job.id),
    event_log: jobEventLogPath(job.id),
    turn: job.turn,
    total_tool_calls: job.totalToolCalls,
    max_tool_calls_per_turn: job.maxToolCalls,
    max_wall_time_minutes_per_turn: job.maxWallTimeMinutes,
    superseded_by: job.supersededBy,
    replacement_for: job.replacementFor,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    last_result: job.lastResult,
    error: job.error,
    runtime,
  };
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function latestImplementation(cwd, workPackageId) {
  return [...jobs.values()]
    .filter(
      (job) =>
        job.phase === "implementation" &&
        job.cwd === cwd &&
        job.workPackageId === workPackageId &&
        !job.supersededBy,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function startJob(args) {
  if (!args.cwd?.trim()) {
    throw new Error("cwd is required and must be the most specific directory containing the research project");
  }
  const cwd = resolve(args.cwd);
  if (!statSync(cwd).isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  const workPackageId = args.work_package_id?.trim();
  if (!workPackageId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workPackageId)) {
    throw new Error("work_package_id must be a stable 1-128 character identifier using letters, numbers, '.', '_', or '-'");
  }
  const phase = args.phase;
  if (!PHASES.includes(phase)) {
    throw new Error(`phase must be one of: ${PHASES.join(", ")}`);
  }
  const persona = args.persona || "implementer";
  if (!personas[persona]) {
    throw new Error(`Unknown persona '${persona}'. Available: ${Object.keys(personas).join(", ")}`);
  }
  if (!PERSONAS_BY_PHASE[phase].includes(persona)) {
    throw new Error(`Persona '${persona}' is not allowed in phase '${phase}'. Allowed: ${PERSONAS_BY_PHASE[phase].join(", ")}`);
  }
  if (!args.brief?.trim()) throw new Error("brief must be a non-empty string");
  const delegationApprovalQuote = args.delegation_approval_quote?.trim() || null;
  if (!delegationApprovalQuote) {
    throw new Error(
      "delegation_approval_quote is required for every new Claude job and must copy the user's explicit opt-in to Claude delegation",
    );
  }
  if (
    DELEGATION_REFUSAL_PATTERN.test(delegationApprovalQuote) ||
    !EXPLICIT_DELEGATION_PATTERN.test(delegationApprovalQuote)
  ) {
    throw new Error(
      "delegation_approval_quote must be an affirmative user request to use Claude, claude-research, or delegate-to-claude; refusals and implementation or experiment approval alone are not delegation approval",
    );
  }
  const approvalQuote = args.approval_quote?.trim() || null;
  if (APPROVAL_PHASES.has(phase) && !approvalQuote) {
    throw new Error(`approval_quote is required for phase '${phase}' and must copy the user's explicit authorization`);
  }

  const previous = phase === "implementation" ? latestImplementation(cwd, workPackageId) : null;
  const replacementFor = args.replace_job_id?.trim() || null;
  const replacementReason = args.replacement_reason?.trim() || null;
  if (previous && replacementFor !== previous.id) {
    throw new Error(
      `Implementation work package '${workPackageId}' already belongs to job ${previous.id}; use reply on that job. If its Claude session is unrecoverable, pass replace_job_id plus replacement_reason explicitly.`,
    );
  }
  if (replacementFor) {
    if (phase !== "implementation") {
      throw new Error("replace_job_id is only valid for implementation jobs");
    }
    if (!previous || previous.id !== replacementFor) {
      throw new Error("replace_job_id must name the current implementation job for this cwd and work_package_id");
    }
    if (previous.process || previous.status === "running" || previous.status === "cancelling") {
      throw new Error(`Replacement job ${previous.id} is still active; cancel and poll it to terminal first`);
    }
    if (!replacementReason) {
      throw new Error("replacement_reason is required when replace_job_id is supplied");
    }
  } else if (replacementReason) {
    throw new Error("replace_job_id is required when replacement_reason is supplied");
  }

  const maxWallTimeMinutes = boundedInteger(
    args.max_wall_time_minutes,
    DEFAULT_MAX_WALL_TIME_MINUTES,
    1,
    1_440,
    "max_wall_time_minutes",
  );
  const maxToolCalls = boundedInteger(
    args.max_tool_calls,
    DEFAULT_MAX_TOOL_CALLS,
    10,
    10_000,
    "max_tool_calls",
  );

  const now = new Date().toISOString();
  const id = randomUUID();
  const job = {
    id,
    sessionId: id,
    cwd,
    workPackageId,
    persona,
    phase,
    approvalQuote,
    delegationApprovalQuote,
    model: args.model || DEFAULT_MODEL,
    effort: args.effort || DEFAULT_EFFORT,
    maxWallTimeMinutes,
    maxToolCalls,
    status: "starting",
    turn: 0,
    process: null,
    budgetTimer: null,
    invocationToolCalls: 0,
    totalToolCalls: 0,
    commandCounts: new Map(),
    budgetWarningEmitted: false,
    events: [],
    nextSeq: 0,
    waiters: new Set(),
    createdAt: now,
    updatedAt: now,
    pendingResult: null,
    lastResult: null,
    error: null,
    brief: args.brief,
    supersededBy: null,
    replacementFor,
  };
  jobs.set(id, job);
  if (previous) {
    previous.supersededBy = id;
    addEvent(previous, "job_superseded", { replacement_job_id: id, reason: replacementReason });
  }
  launch(job, args.brief, false);
  return { ...publicJob(job), next_cursor: 0 };
}

function waitForEvents(job, cursor, waitMs) {
  if (job.events.some((event) => event.seq >= cursor) || job.status !== "running" || waitMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolveWait) => {
    let timer;
    const wake = () => {
      if (timer) clearTimeout(timer);
      job.waiters.delete(wake);
      resolveWait();
    };
    timer = setTimeout(wake, waitMs);
    job.waiters.add(wake);
  });
}

async function pollJob(args) {
  const job = requireJob(args.job_id);
  const cursor = Number.isInteger(args.cursor) && args.cursor >= 0 ? args.cursor : 0;
  const waitMs = Math.min(Math.max(Number(args.wait_ms) || 0, 0), 60_000);
  const maxEvents = Math.min(Math.max(Number(args.max_events) || 50, 1), 200);
  await waitForEvents(job, cursor, waitMs);
  const available = job.events.filter((event) => event.seq >= cursor);
  const events = available.slice(0, maxEvents);
  const nextCursor = events.length ? events.at(-1).seq + 1 : cursor;
  return {
    ...publicJob(job),
    events,
    next_cursor: nextCursor,
    has_more: available.length > events.length,
  };
}

function replyToJob(args) {
  const job = requireJob(args.job_id);
  if (job.process || job.status === "running" || job.status === "cancelling") {
    throw new Error(`Job ${job.id} is still running; poll or cancel it before replying`);
  }
  if (job.phase === "execution") {
    throw new Error("Execution jobs cannot be continued with reply; start a new execution job with a new approval_quote");
  }
  if (!job.delegationApprovalQuote) {
    throw new Error(
      "This job predates the explicit Claude-delegation approval gate and cannot be resumed; obtain explicit user opt-in and start a new job",
    );
  }
  if (!args.message?.trim()) throw new Error("message must be a non-empty string");
  launch(job, args.message, true);
  return { ...publicJob(job), next_cursor: job.nextSeq };
}

function cancelJob(args) {
  const job = requireJob(args.job_id);
  if (!job.process) return publicJob(job);
  requestCancellation(job, args.reason?.trim() || "Cancelled by Codex orchestration");
  return publicJob(job);
}

function loadPersistedJobs() {
  if (!existsSync(STATE_DIR)) return;
  for (const filename of readdirSync(STATE_DIR).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const saved = JSON.parse(readFileSync(join(STATE_DIR, filename), "utf8"));
      if (!saved.id || !saved.sessionId || !saved.cwd || !saved.workPackageId) continue;
      let events = Array.isArray(saved.events) ? saved.events : [];
      const eventLog = jobEventLogPath(saved.id);
      if (existsSync(eventLog)) {
        events = readFileSync(eventLog, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } else if (events.length) {
        appendFileSync(eventLog, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
          mode: 0o600,
        });
      }
      const job = {
        ...saved,
        maxWallTimeMinutes: saved.maxWallTimeMinutes || DEFAULT_MAX_WALL_TIME_MINUTES,
        maxToolCalls: saved.maxToolCalls || DEFAULT_MAX_TOOL_CALLS,
        process: null,
        budgetTimer: null,
        waiters: new Set(),
        commandCounts: new Map(),
        invocationToolCalls: 0,
        budgetWarningEmitted: false,
        totalToolCalls: saved.totalToolCalls || 0,
        events,
        nextSeq: Number.isInteger(saved.nextSeq) ? saved.nextSeq : 0,
      };
      jobs.set(job.id, job);
      if (["starting", "running", "cancelling"].includes(job.status)) {
        job.status = "interrupted";
        addEvent(job, "job_recovered", {
          previous_status: saved.status,
          message: "The MCP process restarted. The Claude session can be continued with reply.",
        });
      }
    } catch (error) {
      process.stderr.write(`Ignoring unreadable Claude job state ${filename}: ${error.message}\n`);
    }
  }
}

loadPersistedJobs();

const TOOL_DEFS = [
  {
    name: "start",
    description: "Start a phase-scoped local Claude Code job and return immediately. Never call this because the user merely asked Codex to implement, test, review, run, or interpret research. Every start requires delegation_approval_quote: an exact affirmative current-conversation request to use Claude, claude-research, or delegate-to-claude. Refusal or stop language is rejected. Implementation and execution additionally require their own phase approval_quote. cwd and work_package_id are required. Reuse an existing implementation job with reply; start rejects accidental replacement implementers. Use fresh review jobs for independence. The brief must include the research contract, constraints, acceptance criteria, and requested evidence.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "Self-contained task brief. Do not pass a vague one-line request." },
        cwd: { type: "string", description: "Required absolute or relative path to the most specific directory containing this research project; do not pass a broad monorepo root for a nested project." },
        work_package_id: {
          type: "string",
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
          description: "Stable identifier shared by the implementation and its related reviews, execution, and interpretation.",
        },
        persona: { type: "string", enum: Object.keys(personas), default: "implementer" },
        phase: {
          type: "string",
          enum: PHASES,
          description: "Immutable job scope. Implementation permits code plus cheap checks; execution permits only the separately approved full run.",
        },
        approval_quote: {
          type: "string",
          description: "Exact phase authorization from the current conversation. Required for implementation and execution; this does not substitute for delegation_approval_quote.",
        },
        delegation_approval_quote: {
          type: "string",
          description: "Exact affirmative user request from the current conversation opting into local Claude delegation. It must request Claude, claude-research, or delegate-to-claude and must not contain refusal or stop language. Required for every phase; never infer, paraphrase, or fabricate it.",
        },
        model: { type: "string", default: DEFAULT_MODEL, description: "Claude model alias or full model name." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], default: DEFAULT_EFFORT },
        max_wall_time_minutes: {
          type: "integer",
          minimum: 1,
          maximum: 1440,
          default: DEFAULT_MAX_WALL_TIME_MINUTES,
          description: "Per-turn wall-time budget. The MCP automatically cancels a worker that exceeds it; reply starts a fresh turn budget.",
        },
        max_tool_calls: {
          type: "integer",
          minimum: 10,
          maximum: 10000,
          default: DEFAULT_MAX_TOOL_CALLS,
          description: "Per-turn tool-call budget. The MCP warns at 80% and cancels after the limit.",
        },
        replace_job_id: {
          type: "string",
          description: "Current implementation job to replace only when its Claude session is genuinely unrecoverable. Normally use reply instead.",
        },
        replacement_reason: {
          type: "string",
          description: "Required concise reason when replace_job_id is used.",
        },
      },
      required: ["brief", "phase", "cwd", "work_package_id", "delegation_approval_quote"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "poll",
    description: "Read new events from a Claude job. Preserve and resend next_cursor. Set wait_ms up to 60000 to wait efficiently. Continue until status is completed, failed, or cancelled and inspect result plus process_exit.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        wait_ms: { type: "integer", minimum: 0, maximum: 60000, default: 0 },
        max_events: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "reply",
    description: "Resume the same persisted Claude Code session for a completed, failed, interrupted, or cancelled implementation, review, or interpretation job. Use this for implementation corrections and milestones instead of starting a replacement. Execution jobs cannot be continued; a repeat run requires a new start and approval quote.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" }, message: { type: "string" } },
      required: ["job_id", "message"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "list",
    description: "List durable Claude jobs loaded from this MCP process's state directory, including sessions recovered after a restart.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "cancel",
    description: "Cancel any running Claude worker at Codex's discretion. Delegation gives Codex full authority over worker lifecycle, so no separate user approval is required. This does not authorize starting or repeating an experiment execution.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        reason: {
          type: "string",
          description: "Optional concise reason recorded in the job event log.",
        },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "personas",
    description: "List the available local Claude research personas and their purposes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

async function callTool(name, args = {}) {
  if (name === "start") return startJob(args);
  if (name === "poll") return pollJob(args);
  if (name === "reply") return replyToJob(args);
  if (name === "list") return { runtime, state_directory: STATE_DIR, jobs: [...jobs.values()].map(publicJob) };
  if (name === "cancel") return cancelJob(args);
  if (name === "personas") {
    return {
      runtime,
      personas: Object.values(personas).map(({ name, title, summary }) => ({ name, title, summary })),
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ok(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    rpcError(null, -32700, "Parse error");
    return;
  }

  if (request.method === "initialize") {
    ok(request.id, {
      protocolVersion: request.params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "claude-research", version: pluginManifest.version },
      instructions: SERVER_INSTRUCTIONS,
    });
    return;
  }
  if (request.method === "notifications/initialized" || request.method?.startsWith("notifications/")) return;
  if (request.method === "ping") {
    ok(request.id, {});
    return;
  }
  if (request.method === "tools/list") {
    ok(request.id, { tools: TOOL_DEFS });
    return;
  }
  if (request.method === "tools/call") {
    try {
      const result = await callTool(request.params?.name, request.params?.arguments || {});
      ok(request.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    } catch (error) {
      ok(request.id, {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      });
    }
    return;
  }
  if (request.id !== undefined) rpcError(request.id, -32601, `Method not found: ${request.method}`);
});

function shutdown() {
  for (const job of jobs.values()) {
    if (job.process) {
      job.status = "interrupted";
      addEvent(job, "mcp_shutdown", {
        message: "The MCP server stopped this worker; resume the persisted Claude session with reply.",
      });
      job.process.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
