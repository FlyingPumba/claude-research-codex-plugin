#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
const jobs = new Map();

const SERVER_INSTRUCTIONS = `Local Claude Code executor for trustworthy research. Every persona receives the shared standing research decisions in addition to its role prompt. Call start with an explicit persona and self-contained brief, then poll with the returned job_id and cursor until terminal. Use reply for corrections in the same Claude session; use a fresh start for independent review. Opus runs locally with dangerous permissions. Before trusting an experiment, independently use code-reviewer, experiment-auditor, and measurement-auditor; use falsifier for competing explanations and results-interpreter after runs. Codex must synthesize evidence and inspect actual artifacts.`;

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

function addEvent(job, kind, data = {}) {
  const event = {
    seq: job.nextSeq++,
    at: new Date().toISOString(),
    kind,
    ...data,
  };
  job.events.push(event);
  job.updatedAt = event.at;
  for (const wake of job.waiters) wake();
  job.waiters.clear();
  return event;
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
      const { kind, ...data } = event;
      addEvent(job, kind, data);
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

function buildPrompt(persona, brief, continuation = false) {
  const framing = continuation
    ? "Codex is continuing your existing assignment. Treat the message below as review feedback or an additional request. Preserve the agreed experiment contract and explicitly report any requested change you cannot safely make."
    : "Codex has delegated this assignment after discussing the research direction with the user. Work autonomously in the local checkout. Do not silently resolve scientifically meaningful ambiguity: state assumptions and deviations. Inspect actual files and evidence, and finish with findings, commands run, failures, unresolved risks, and artifact paths.";
  return `${framing}\n\n${continuation ? "FOLLOW-UP" : "TASK BRIEF"}:\n${brief}`;
}

function claudeArgs(job, prompt, continuation) {
  const args = [
    "-p",
    buildPrompt(job.persona, prompt, continuation),
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
  addEvent(job, continuation ? "reply_started" : "job_started", {
    turn: job.turn,
    persona: job.persona,
    model: job.model,
  });

  const child = spawn(CLAUDE_BIN, claudeArgs(job, prompt, continuation), {
    cwd: job.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.process = child;

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
    job.status = "failed";
    job.error = error.message;
    job.process = null;
    addEvent(job, "process_error", { error: error.message });
  });

  child.on("close", (code, signal) => {
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
    status: job.status,
    persona: job.persona,
    model: job.model,
    effort: job.effort,
    cwd: job.cwd,
    turn: job.turn,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    last_result: job.lastResult,
    error: job.error,
  };
}

function startJob(args) {
  const cwd = resolve(args.cwd || process.cwd());
  if (!statSync(cwd).isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
  const persona = args.persona || "implementer";
  if (!personas[persona]) {
    throw new Error(`Unknown persona '${persona}'. Available: ${Object.keys(personas).join(", ")}`);
  }
  if (!args.brief?.trim()) throw new Error("brief must be a non-empty string");

  const now = new Date().toISOString();
  const id = randomUUID();
  const job = {
    id,
    sessionId: id,
    cwd,
    persona,
    model: args.model || DEFAULT_MODEL,
    effort: args.effort || DEFAULT_EFFORT,
    status: "starting",
    turn: 0,
    process: null,
    events: [],
    nextSeq: 0,
    waiters: new Set(),
    createdAt: now,
    updatedAt: now,
    pendingResult: null,
    lastResult: null,
    error: null,
  };
  jobs.set(id, job);
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
  const waitMs = Math.min(Math.max(Number(args.wait_ms) || 0, 0), 30_000);
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
  if (!args.message?.trim()) throw new Error("message must be a non-empty string");
  launch(job, args.message, true);
  return { ...publicJob(job), next_cursor: job.nextSeq };
}

function cancelJob(args) {
  const job = requireJob(args.job_id);
  if (!job.process) return publicJob(job);
  job.status = "cancelling";
  addEvent(job, "cancel_requested");
  job.process.kill("SIGTERM");
  const child = job.process;
  const timer = setTimeout(() => {
    if (job.process === child) child.kill("SIGKILL");
  }, 1_000);
  timer.unref();
  return publicJob(job);
}

const TOOL_DEFS = [
  {
    name: "start",
    description: "Start a local Claude Code job and return immediately. Use implementer for code changes; use fresh independent jobs for code-reviewer, experiment-auditor, measurement-auditor, falsifier, and results-interpreter. Default model is Opus. The brief must include the research contract, relevant paths, constraints, acceptance criteria, and requested evidence.",
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: "Self-contained task brief. Do not pass a vague one-line request." },
        cwd: { type: "string", description: "Local repository working directory. Defaults to the MCP process cwd." },
        persona: { type: "string", enum: Object.keys(personas), default: "implementer" },
        model: { type: "string", default: DEFAULT_MODEL, description: "Claude model alias or full model name." },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"], default: DEFAULT_EFFORT },
      },
      required: ["brief"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "poll",
    description: "Read new events from a Claude job. Preserve and resend next_cursor. Set wait_ms up to 30000 to wait efficiently. Continue until status is completed, failed, or cancelled and inspect result plus process_exit.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        cursor: { type: "integer", minimum: 0, default: 0 },
        wait_ms: { type: "integer", minimum: 0, maximum: 30000, default: 0 },
        max_events: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "reply",
    description: "Continue a completed or failed Claude job in the same persisted Claude session. Use for implementation corrections or follow-up questions. Start a fresh job instead when independence matters.",
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
    description: "List Claude jobs known to this local MCP process.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "cancel",
    description: "Cancel a running Claude job.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
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
  if (name === "list") return { jobs: [...jobs.values()].map(publicJob) };
  if (name === "cancel") return cancelJob(args);
  if (name === "personas") {
    return {
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
      serverInfo: { name: "claude-research", version: "0.1.0" },
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
    if (job.process) job.process.kill("SIGTERM");
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
