import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = resolve(TESTS_DIR, "..");
const MCP_ENTRY = join(MCP_DIR, "index.mjs");
const FAKE_CLAUDE = join(TESTS_DIR, "fake-claude.mjs");

class McpClient {
  constructor(env) {
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.process = spawn(process.execPath, [MCP_ENTRY], {
      cwd: resolve(MCP_DIR, ".."),
      env: { ...process.env, ...env },
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
    this.process.kill("SIGTERM");
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
  assert.match(init.instructions, /trustworthy research/i);

  const tools = (await client.request("tools/list")).result.tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["start", "poll", "reply", "list", "cancel", "personas"],
  );

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

test("starts, polls, and resumes the same dangerous local Claude session", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "claude-research-test-"));
  const logPath = join(temp, "claude.jsonl");
  const client = new McpClient({
    CLAUDE_RESEARCH_CLAUDE_BIN: FAKE_CLAUDE,
    FAKE_CLAUDE_LOG: logPath,
  });
  t.after(() => client.close());
  await client.initialize();

  const started = await client.call("start", {
    cwd: temp,
    persona: "implementer",
    brief: "Implement a seeded synthetic experiment and persist raw measurements.",
  });
  assert.equal(started.isError, undefined);
  assert.equal(started.structuredContent.model, "opus");
  const jobId = started.structuredContent.job_id;

  const first = await pollUntilTerminal(client, jobId);
  assert.equal(first.snapshot.status, "completed");
  assert.equal(first.snapshot.last_result.result, "Implementation complete.");
  assert.ok(first.events.some((event) => event.kind === "assistant_text"));
  assert.ok(first.events.some((event) => event.kind === "tool_use"));

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
  assert.ok(invocations[0].args.includes("--dangerously-skip-permissions"));
  assert.equal(invocations[0].args[invocations[0].args.indexOf("--model") + 1], "opus");
  assert.equal(invocations[0].args[invocations[0].args.indexOf("--effort") + 1], "high");
  assert.match(
    invocations[0].args[invocations[0].args.indexOf("--append-system-prompt") + 1],
    /scientific contract/i,
  );
  assert.equal(invocations[1].args[invocations[1].args.indexOf("--resume") + 1], jobId);
  assert.equal(invocations[1].resumed, true);
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
    persona: "agreeable-helper",
    brief: "Do something vague.",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown persona/);
});
