import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = resolve(TESTS_DIR, "..");
const MCP_ENTRY = join(MCP_DIR, "index.mjs");
const FAKE_CLAUDE = join(TESTS_DIR, "fake-claude.mjs");
const PLUGIN_DIR = resolve(MCP_DIR, "..");
const SKILL_PATH = join(PLUGIN_DIR, "skills", "delegate-to-claude", "SKILL.md");
const README_PATH = resolve(PLUGIN_DIR, "..", "..", "README.md");
const DELEGATION_APPROVAL_QUOTE = "Use $delegate-to-claude for this research workflow.";

class McpClient {
  constructor(env = {}) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.stateDir = env.CLAUDE_RESEARCH_STATE_DIR || mkdtempSync(join(tmpdir(), "claude-research-state-"));
    this.process = spawn(process.execPath, [MCP_ENTRY], {
      cwd: resolve(MCP_DIR, ".."),
      env: { ...process.env, ...env, CLAUDE_RESEARCH_STATE_DIR: this.stateDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message);
      }
    });
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    this.process.on("exit", (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP exited ${code}: ${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolveResponse, rejectResponse) => {
      this.pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
    });
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return response;
  }

  notify(method, params = {}) {
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    const response = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    this.notify("notifications/initialized");
    return response.result;
  }

  async call(name, args = {}) {
    const response = await this.request("tools/call", { name, arguments: args });
    return response.result;
  }

  close() {
    if (this.process.exitCode !== null) return Promise.resolve();
    const exited = new Promise((resolveExit) => this.process.once("exit", resolveExit));
    this.process.kill("SIGTERM");
    return exited;
  }
}

async function pollUntilTerminal(client, jobId, cursor = 0) {
  const allEvents = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await client.call("poll", {
      job_id: jobId,
      cursor,
      wait_ms: 1_000,
      max_events: 200,
    });
    assert.equal(response.isError, undefined);
    const snapshot = response.structuredContent;
    allEvents.push(...snapshot.events);
    cursor = snapshot.next_cursor;
    if (["completed", "failed", "cancelled"].includes(snapshot.status)) {
      return { snapshot, events: allEvents, cursor };
    }
  }
  assert.fail("job did not reach a terminal state");
}

test("advertises the local research contract and personas", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
  });
  t.after(() => client.close());

  const init = await client.initialize();
  assert.equal(init.serverInfo.name, "claude-research");
  assert.match(init.serverInfo.version, /^0\.1\.0\+codex\./);
  assert.match(init.instructions, /trustworthy research/i);

  const tools = (await client.request("tools/list")).result.tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["start", "poll", "reply", "list", "cancel", "personas"],
  );
  const startTool = tools.find((tool) => tool.name === "start");
  const pollTool = tools.find((tool) => tool.name === "poll");
  const cancelTool = tools.find((tool) => tool.name === "cancel");
  assert.deepEqual(startTool.inputSchema.required, [
    "brief",
    "phase",
    "cwd",
    "work_package_id",
    "delegation_approval_quote",
  ]);
  assert.match(startTool.description, /never call this because the user merely asked Codex to implement/i);
  assert.match(startTool.inputSchema.properties.delegation_approval_quote.description, /affirmative user request/i);
  assert.equal(pollTool.inputSchema.properties.wait_ms.maximum, 60_000);
  assert.match(pollTool.description, /60000/);
  assert.deepEqual(cancelTool.inputSchema.required, ["job_id"]);
  assert.match(cancelTool.description, /full authority over worker lifecycle/i);

  const personaResult = await client.call("personas");
  assert.deepEqual(
    personaResult.structuredContent.personas.map((persona) => persona.name),
    [
      "code-reviewer",
      "experiment-auditor",
      "falsifier",
      "implementer",
      "measurement-auditor",
      "results-interpreter",
    ],
  );
});

test("documents Claude delegation as explicit opt-in rather than an implementation default", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");
  const readme = readFileSync(README_PATH, "utf8");

  assert.match(skill, /only when the user explicitly asks to use Claude/);
  assert.match(skill, /Never infer Claude delegation from a request to implement, test, review, run, or interpret research/);
  assert.match(skill, /implementation or experiment approval alone is not delegation approval/i);
  assert.match(readme, /Claude delegation and implementation approval are distinct/);
  assert.match(readme, /“Implement this,” “add tests,” “review this,”/);
});

test("starts, polls, and resumes the same dangerous local Claude session", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const logPath = join(temp, "claude.jsonl");
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: logPath,
    CLAUDE_APPEND_SYSTEM_PROMPT: "Always stop and ask before doing anything.",
  });
  t.after(() => client.close());
  await client.initialize();

  const started = await client.call("start", {
    cwd: temp,
    work_package_id: "synthetic-implementation",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "I approve this contract and its implementation.",
    brief: "Implement a seeded synthetic experiment and persist raw measurements.",
  });
  assert.equal(started.isError, undefined);
  assert.equal(started.structuredContent.model, "opus");
  assert.equal(started.structuredContent.phase, "implementation");
  assert.equal(started.structuredContent.work_package_id, "synthetic-implementation");
  assert.match(started.structuredContent.runtime.plugin_version, /^0\.1\.0\+codex\./);
  assert.equal(existsSync(started.structuredContent.state_file), true);
  assert.equal(
    started.structuredContent.approval_quote,
    "I approve this contract and its implementation.",
  );
  assert.equal(started.structuredContent.delegation_approval_quote, DELEGATION_APPROVAL_QUOTE);
  const jobId = started.structuredContent.job_id;

  const first = await pollUntilTerminal(client, jobId);
  assert.equal(first.snapshot.status, "completed");
  assert.equal(first.snapshot.last_result.result, "Implementation complete.");
  assert.ok(first.events.some((event) => event.kind === "assistant_text"));
  assert.ok(first.events.some((event) => event.kind === "tool_use"));
  assert.equal(
    first.events.some((event) => event.kind === "claude_event" && event.data.includes("thinking_tokens")),
    false,
  );

  const replied = await client.call("reply", {
    job_id: jobId,
    message: "Fix the reviewer finding and rerun the synthetic check.",
  });
  assert.equal(replied.isError, undefined);
  const second = await pollUntilTerminal(client, jobId, replied.structuredContent.next_cursor);
  assert.equal(second.snapshot.status, "completed");
  assert.equal(second.snapshot.last_result.result, "Review corrections complete.");
  assert.equal(second.snapshot.session_id, first.snapshot.session_id);

  const invocations = readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].globalAppendSystemPrompt, null);
  assert.ok(invocations[0].args.includes("--dangerously-skip-permissions"));
  assert.equal(invocations[0].args[invocations[0].args.indexOf("--model") + 1], "opus");
  assert.equal(invocations[0].args[invocations[0].args.indexOf("--effort") + 1], "high");
  assert.match(invocations[0].prompt, /WORKFLOW PHASE: implementation/);
  assert.match(invocations[0].prompt, /CLAUDE DELEGATION APPROVAL: Use \$delegate-to-claude/);
  assert.match(invocations[0].prompt, /I approve this contract and its implementation\./);
  assert.match(invocations[0].prompt, /FORBIDDEN: launch the full, expensive/);
  assert.match(
    invocations[0].args[invocations[0].args.indexOf("--append-system-prompt") + 1],
    /scientific contract/i,
  );
  assert.match(
    invocations[0].args[invocations[0].args.indexOf("--append-system-prompt") + 1],
    /Never use a silent fallback/i,
  );
  assert.match(
    invocations[0].args[invocations[0].args.indexOf("--append-system-prompt") + 1],
    /Never substitute a dataset/i,
  );
  assert.match(
    invocations[0].args[invocations[0].args.indexOf("--append-system-prompt") + 1],
    /add a regression test when feasible/i,
  );
  assert.match(
    invocations[0].args[invocations[0].args.indexOf("--append-system-prompt") + 1],
    /primary path and at least one meaningful edge case/i,
  );
  assert.equal(invocations[1].args[invocations[1].args.indexOf("--resume") + 1], jobId);
  assert.equal(invocations[1].resumed, true);
  assert.match(invocations[1].prompt, /WORKFLOW PHASE: implementation/);
});

test("preserves long Claude evidence without truncation", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
    FAKE_CLAUDE_LONG_TEXT_LENGTH: "20000",
  });
  t.after(() => client.close());
  await client.initialize();

  const started = await client.call("start", {
    cwd: temp,
    work_package_id: "long-evidence",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement the agreed diagnostic.",
    brief: "Return complete diagnostic evidence.",
  });
  const completed = await pollUntilTerminal(client, started.structuredContent.job_id);
  const assistant = completed.events.find((event) => event.kind === "assistant_text");

  assert.equal(assistant.text.length, 20000);
  assert.equal(completed.snapshot.last_result.result.length, 20000);
  assert.doesNotMatch(assistant.text, /truncated/);
  assert.doesNotMatch(completed.snapshot.last_result.result, /truncated/);
});

test("enforces one canonical implementer per work package unless replacement is explicit", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
  });
  t.after(() => client.close());
  await client.initialize();

  const first = await client.call("start", {
    cwd: temp,
    work_package_id: "one-implementer",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement this work package.",
    brief: "Implement the first milestone.",
  });
  await pollUntilTerminal(client, first.structuredContent.job_id);

  const accidental = await client.call("start", {
    cwd: temp,
    work_package_id: "one-implementer",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement this work package.",
    brief: "Start over from scratch.",
  });
  assert.equal(accidental.isError, true);
  assert.match(accidental.content[0].text, /use reply on that job/i);

  const replacement = await client.call("start", {
    cwd: temp,
    work_package_id: "one-implementer",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement this work package.",
    brief: "Recover from an unavailable native Claude transcript.",
    replace_job_id: first.structuredContent.job_id,
    replacement_reason: "The native Claude session cannot be resumed.",
  });
  assert.equal(replacement.isError, undefined);
  assert.equal(replacement.structuredContent.replacement_for, first.structuredContent.job_id);
  await pollUntilTerminal(client, replacement.structuredContent.job_id);
});

test("reloads durable jobs after an MCP restart and resumes the same Claude session", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const stateDir = join(temp, "state");
  const logPath = join(temp, "claude.jsonl");
  const env = {
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    CLAUDE_RESEARCH_STATE_DIR: stateDir,
    FAKE_CLAUDE_LOG: logPath,
  };
  const firstClient = new McpClient(env);
  await firstClient.initialize();
  const started = await firstClient.call("start", {
    cwd: temp,
    work_package_id: "durable-session",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement the durable work package.",
    brief: "Complete one milestone and persist the job.",
  });
  await pollUntilTerminal(firstClient, started.structuredContent.job_id);
  await firstClient.close();

  const secondClient = new McpClient(env);
  t.after(() => secondClient.close());
  await secondClient.initialize();
  const listed = await secondClient.call("list");
  assert.ok(listed.structuredContent.jobs.some((job) => job.job_id === started.structuredContent.job_id));

  const replied = await secondClient.call("reply", {
    job_id: started.structuredContent.job_id,
    message: "Continue with the next milestone from the durable ledger.",
  });
  const completed = await pollUntilTerminal(
    secondClient,
    started.structuredContent.job_id,
    replied.structuredContent.next_cursor,
  );
  assert.equal(completed.snapshot.session_id, started.structuredContent.session_id);

  const invocations = readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(invocations[1].resumed, true);
  assert.equal(invocations[1].sessionId, invocations[0].sessionId);
});

test("refuses to resume a persisted job that predates explicit Claude opt-in", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const stateDir = join(temp, "state");
  const legacyJobId = "00000000-0000-4000-8000-000000000000";
  mkdirSync(stateDir);
  writeFileSync(
    join(stateDir, `${legacyJobId}.json`),
    `${JSON.stringify({
      id: legacyJobId,
      sessionId: legacyJobId,
      cwd: temp,
      workPackageId: "legacy-without-delegation-opt-in",
      persona: "implementer",
      phase: "implementation",
      approvalQuote: "Implement this.",
      status: "completed",
      turn: 1,
      nextSeq: 0,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      brief: "Legacy job fixture.",
    })}\n`,
  );

  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    CLAUDE_RESEARCH_STATE_DIR: stateDir,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
  });
  t.after(() => client.close());
  await client.initialize();

  const reply = await client.call("reply", {
    job_id: legacyJobId,
    message: "Continue implementing.",
  });
  assert.equal(reply.isError, true);
  assert.match(reply.content[0].text, /predates the explicit Claude-delegation approval gate/);
  assert.equal(existsSync(join(temp, "claude.jsonl")), false);
});

test("warns about masked test failures, repeated commands, and excessive tool loops", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
    FAKE_CLAUDE_TOOL_COMMAND: "pytest -q | tail -20",
    FAKE_CLAUDE_TOOL_REPEATS: "11",
  });
  t.after(() => client.close());
  await client.initialize();

  const started = await client.call("start", {
    cwd: temp,
    work_package_id: "test-discipline",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement the test-discipline fixture.",
    brief: "Exercise diagnostic guardrails.",
    max_tool_calls: 10,
  });
  const terminal = await pollUntilTerminal(client, started.structuredContent.job_id);
  assert.ok(terminal.events.some((event) => event.policy === "masked_test_exit_status"));
  assert.ok(terminal.events.some((event) => event.policy === "repeated_command"));
  assert.ok(terminal.events.some((event) => event.kind === "budget_warning"));
  assert.ok(terminal.events.some((event) => event.kind === "budget_cancel_requested"));
  assert.equal(terminal.snapshot.status, "cancelled");
});

test("rejects an unknown persona without launching Claude", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
  });
  t.after(() => client.close());
  await client.initialize();

  const result = await client.call("start", {
    cwd: temp,
    work_package_id: "unknown-persona",
    persona: "agreeable-helper",
    phase: "review",
    brief: "Do something vague.",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown persona/);
});

test("does not treat implementation approval as permission to delegate to Claude", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const logPath = join(temp, "claude.jsonl");
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: logPath,
  });
  t.after(() => client.close());
  await client.initialize();

  const missingDelegationApproval = await client.call("start", {
    cwd: temp,
    work_package_id: "no-silent-delegation",
    persona: "implementer",
    phase: "implementation",
    approval_quote: "Ok, great, let's implement this, and add tests for it!",
    brief: "Implement the agreed experiment changes.",
  });
  assert.equal(missingDelegationApproval.isError, true);
  assert.match(missingDelegationApproval.content[0].text, /delegation_approval_quote is required/);
  assert.equal(existsSync(logPath), false);

  const vagueDelegationApproval = await client.call("start", {
    cwd: temp,
    work_package_id: "no-silent-delegation",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: "Please hand this off.",
    approval_quote: "Ok, great, let's implement this, and add tests for it!",
    brief: "Implement the agreed experiment changes.",
  });
  assert.equal(vagueDelegationApproval.isError, true);
  assert.match(vagueDelegationApproval.content[0].text, /must be an affirmative user request/);
  assert.equal(existsSync(logPath), false);

  const explicitRefusal = await client.call("start", {
    cwd: temp,
    work_package_id: "no-silent-delegation",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: "I never asked for Claude-based development.",
    approval_quote: "Ok, great, let's implement this, and add tests for it!",
    brief: "Implement the agreed experiment changes.",
  });
  assert.equal(explicitRefusal.isError, true);
  assert.match(explicitRefusal.content[0].text, /refusals/);
  assert.equal(existsSync(logPath), false);
});

test("enforces phase, persona, and separate approval boundaries", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
  });
  t.after(() => client.close());
  await client.initialize();

  const missingPhase = await client.call("start", {
    cwd: temp,
    work_package_id: "phase-boundaries",
    persona: "implementer",
    brief: "Implement the contract.",
  });
  assert.equal(missingPhase.isError, true);
  assert.match(missingPhase.content[0].text, /phase must be one of/);

  const missingImplementationApproval = await client.call("start", {
    cwd: temp,
    work_package_id: "phase-boundaries",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    brief: "Implement the contract.",
  });
  assert.equal(missingImplementationApproval.isError, true);
  assert.match(missingImplementationApproval.content[0].text, /approval_quote is required/);

  const wrongPersona = await client.call("start", {
    cwd: temp,
    work_package_id: "phase-boundaries",
    persona: "code-reviewer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement the contract.",
    brief: "Implement the contract.",
  });
  assert.equal(wrongPersona.isError, true);
  assert.match(wrongPersona.content[0].text, /is not allowed in phase 'implementation'/);

  const review = await client.call("start", {
    cwd: temp,
    work_package_id: "phase-boundaries",
    persona: "code-reviewer",
    phase: "review",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    brief: "Independently inspect the implementation against the frozen contract.",
  });
  assert.equal(review.isError, undefined);
  const completedReview = await pollUntilTerminal(client, review.structuredContent.job_id);
  assert.equal(completedReview.snapshot.phase, "review");
  assert.equal(completedReview.snapshot.approval_quote, null);
  assert.equal(completedReview.snapshot.delegation_approval_quote, DELEGATION_APPROVAL_QUOTE);

  const missingExecutionApproval = await client.call("start", {
    cwd: temp,
    work_package_id: "phase-boundaries",
    persona: "implementer",
    phase: "execution",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    brief: "Run the frozen, audited experiment.",
  });
  assert.equal(missingExecutionApproval.isError, true);
  assert.match(missingExecutionApproval.content[0].text, /approval_quote is required/);

  const execution = await client.call("start", {
    cwd: temp,
    work_package_id: "phase-boundaries",
    persona: "implementer",
    phase: "execution",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Launch the frozen experiment now.",
    brief: "Run the frozen, audited experiment without changing tracked code.",
  });
  assert.equal(execution.isError, undefined);
  const completedExecution = await pollUntilTerminal(client, execution.structuredContent.job_id);
  assert.equal(completedExecution.snapshot.phase, "execution");

  const executionReply = await client.call("reply", {
    job_id: execution.structuredContent.job_id,
    message: "Run it again.",
  });
  assert.equal(executionReply.isError, true);
  assert.match(executionReply.content[0].text, /Execution jobs cannot be continued/);
});

test("lets Codex cancel a running Claude without separate user approval", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: join(temp, "claude.jsonl"),
    FAKE_CLAUDE_DELAY_MS: "10000",
  });
  t.after(() => client.close());
  await client.initialize();

  const started = await client.call("start", {
    cwd: temp,
    work_package_id: "cancel-worker",
    persona: "implementer",
    phase: "implementation",
    delegation_approval_quote: DELEGATION_APPROVAL_QUOTE,
    approval_quote: "Implement the agreed contract.",
    brief: "Implement a deliberately slow test fixture.",
  });

  const cancelled = await client.call("cancel", {
    job_id: started.structuredContent.job_id,
    reason: "Redundant broad test rerun after documentation-only edits.",
  });
  assert.equal(cancelled.isError, undefined);
  assert.equal(cancelled.structuredContent.status, "cancelling");

  const terminal = await pollUntilTerminal(client, started.structuredContent.job_id);
  assert.equal(terminal.snapshot.status, "cancelled");
  assert.ok(
    terminal.events.some(
      (event) =>
        event.kind === "cancel_requested" &&
        event.reason === "Redundant broad test rerun after documentation-only edits.",
    ),
  );
});
