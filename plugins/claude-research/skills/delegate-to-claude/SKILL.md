---
name: delegate-to-claude
description: Discuss and formalize AI-safety research with Codex before explicitly approved local Claude Code/Opus implementation, independent audits, separately approved experiment execution, and evidence-based interpretation. Use when the user wants Codex to remain the research interlocutor while Claude implements or reviews an experiment, or whenever a research conclusion depends on code producing a trustworthy signal.
---

# Delegate to Claude

Keep Codex responsible for research dialogue, synthesis, and epistemic judgment. Use the `claude_research` MCP tools to give implementation and independent audits to fresh Claude Code sessions. Do not make implementation edits directly while using this workflow; send corrections to the implementer session.

Read [experiment-trust.md](references/experiment-trust.md) before implementing or interpreting a consequential experiment.

## Follow the approval state machine

Start in **discussion**. In this phase, reason with the user and inspect the repository read-only. Do not edit files, call `start` or `reply`, delegate implementation, or launch an experiment. Questions, hypotheticals, requests for a plan, and phrases such as “how would we” are not approval.

Move through these phases in order:

1. **Discussion:** agree on the experiment contract and implementation plan.
2. **Implementation:** enter only after the user explicitly approves implementation. Permit code changes, tests, and cheap smoke checks, but not the full experiment.
3. **Review:** run fresh independent gates and resolve their findings.
4. **Execution:** enter only after reporting the gate results and receiving separate explicit approval for the full run.
5. **Interpretation:** inspect completed-run evidence with a fresh interpreter.

When approval is required, copy the user's exact authorization from the current conversation into `approval_quote`. Never infer, paraphrase, or fabricate approval. A complete first message that explicitly commands implementation can provide implementation approval if it also fixes the necessary contract; otherwise finish the contract and ask.

## Establish the experiment contract

Do not delegate a vague research idea. First agree with the user on a compact contract containing:

- research question and claim the experiment could support;
- intervention or comparison and the relevant unit of analysis;
- outcomes, metrics, aggregation, and uncertainty estimates;
- baselines, controls, expected positive and negative patterns;
- known confounders, failure modes, and disconfirming outcomes;
- required artifacts and acceptance criteria.

Mark unresolved choices explicitly. Never let the implementer silently choose a scientifically meaningful default.

Ask the user to approve the contract and implementation plan. Until the response contains explicit authorization, remain in discussion and do not call the Claude MCP.

## Delegate implementation

After explicit implementation approval, call `start` with phase `implementation`, persona `implementer`, the exact `approval_quote`, model `opus`, the repository `cwd`, and a self-contained brief. Include the experiment contract, relevant paths, constraints, exact acceptance criteria, and verification commands. State that the full experiment is not authorized.

Call `poll` with the returned job ID and cursor until it completes. Inspect the actual working tree, generated artifacts, and test output; do not rely only on the implementer's summary.

If implementation deviates from the contract or review finds defects, call `reply` on the same job. Preserve the original contract in the correction message and poll again.

## Run independent gates

Use fresh sessions so reviewers are not anchored by the implementer's reasoning. Give them the original contract and paths to the actual code and artifacts, not the implementer's self-assessment.

Call `start` with phase `review` for every reviewer. Review jobs do not require `approval_quote`, cannot edit tracked implementation files, and cannot launch the full experiment.

Before an expensive or conclusion-bearing run, use:

1. `code-reviewer` to find ordinary implementation bugs.
2. `experiment-auditor` to find design errors, confounding, leakage, hidden choices, and mismatches between the claim and implemented experiment.
3. `measurement-auditor` to validate metrics, denominators, masks, aggregation, instrumentation, and artifact completeness.
4. `falsifier` when alternative explanations would materially change the conclusion; ask for the cheapest decisive controls.

Start independent audits concurrently when their scopes do not overlap. Synthesize findings yourself. Ask the implementer to fix every critical issue and resolve or explicitly waive every high-severity issue with the user. Re-run affected audits after fixes.

## Approve and execute the run

Report the resolved and unresolved gate findings before execution. Ask for separate explicit approval to launch the full, expensive, or conclusion-bearing run. Implementation approval does not count as execution approval.

After execution approval, start a new job with phase `execution`, persona `implementer`, and the new exact `approval_quote`. Give it the frozen contract, command, resolved configuration, artifact paths, and monitoring requirements. Do not use `reply` to turn an implementation job into execution. Do not let the execution job edit tracked experiment code; if a change is needed, return to implementation and repeat affected gates.

A retry or materially repeated full run requires a new execution approval and a fresh `start` job.

## Interpret results

After the run, call `start` with phase `interpretation` and a fresh `results-interpreter`, passing the experiment contract plus paths to raw outputs, resolved configuration, logs, and summaries. Require it to inspect evidence rather than accept a narrated result.

Classify the outcome as:

- **trustworthy signal**: implementation and validity gates passed and the evidence supports the bounded claim;
- **provisional signal**: informative, but a named uncertainty or missing control remains;
- **uninformative**: bugs, missing provenance, failed manipulation checks, inadequate power, or ambiguous measurement prevent interpretation.

Report what the experiment rules out, what it does not rule out, anomalies, reviewer disagreements, and the smallest next experiment that would reduce the main uncertainty. A null result is not evidence of absence unless the design had demonstrated power to detect the effect of interest.

## Tool discipline

- Use one job ID per independent agent and preserve cursors between `poll` calls.
- Treat a job's phase as immutable. Use `reply` only within implementation, review, or interpretation. Start a fresh job for independent review or any execution.
- Prefer Opus for implementation and all conclusion-bearing audits unless the user requests otherwise.
- Never call `cancel` without explicit user authorization to terminate that job. Copy the exact authorization into `approval_quote`.
- Never fabricate agent findings while a job is running.
