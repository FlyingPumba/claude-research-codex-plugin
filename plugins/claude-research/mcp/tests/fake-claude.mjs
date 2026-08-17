#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const sessionId = valueAfter("--session-id") || valueAfter("--resume") || "missing-session";
const prompt = valueAfter("-p") || "";
const resumed = args.includes("--resume");

if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({ args, sessionId, prompt, resumed, cwd: process.cwd() })}\n`,
  );
}

console.log(
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: valueAfter("--model"),
    cwd: process.cwd(),
  }),
);
console.log(
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: resumed ? "Applied review feedback." : "Implemented the experiment." },
        { type: "tool_use", name: "Bash", input: { command: "pytest -q" } },
      ],
    },
  }),
);
console.log(
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: resumed ? "Review corrections complete." : "Implementation complete.",
    session_id: sessionId,
    total_cost_usd: 0.01,
    duration_ms: 5,
    num_turns: 1,
  }),
);
