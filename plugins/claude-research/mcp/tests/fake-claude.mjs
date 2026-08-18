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
const longTextLength = Number.parseInt(process.env.FAKE_CLAUDE_LONG_TEXT_LENGTH || "0", 10);
const delayMs = Number.parseInt(process.env.FAKE_CLAUDE_DELAY_MS || "0", 10);
const toolCommand = process.env.FAKE_CLAUDE_TOOL_COMMAND || "pytest -q";
const toolRepeats = Number.parseInt(process.env.FAKE_CLAUDE_TOOL_REPEATS || "1", 10);
const assistantText = longTextLength > 0
  ? "A".repeat(longTextLength)
  : resumed ? "Applied review feedback." : "Implemented the experiment.";
const resultText = longTextLength > 0
  ? "R".repeat(longTextLength)
  : resumed ? "Review corrections complete." : "Implementation complete.";

if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({
      args,
      sessionId,
      prompt,
      resumed,
      cwd: process.cwd(),
      globalAppendSystemPrompt: process.env.CLAUDE_APPEND_SYSTEM_PROMPT ?? null,
    })}\n`,
  );
}

if (delayMs > 0) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
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
    type: "system",
    subtype: "thinking_tokens",
    estimated_tokens: 100,
    estimated_tokens_delta: 100,
    session_id: sessionId,
  }),
);
console.log(
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: assistantText },
        ...Array.from({ length: toolRepeats }, (_, index) => ({
          type: "tool_use",
          id: `tool-${index}`,
          name: "Bash",
          input: { command: toolCommand },
        })),
      ],
    },
  }),
);
console.log(
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: resultText,
    session_id: sessionId,
    total_cost_usd: 0.01,
    duration_ms: 5,
    num_turns: 1,
  }),
);
