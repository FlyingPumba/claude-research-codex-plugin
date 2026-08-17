---
name: delegate-to-claude
description: Delegate agreed coding and AI-safety research work from Codex to local Claude Code/Opus agents, then independently audit implementation correctness, experiment design, measurement validity, alternative explanations, and result interpretation. Use when the user wants Codex to remain the research interlocutor while Claude implements or reviews an experiment, or whenever a research conclusion depends on code producing a trustworthy signal.
---

# Delegate to Claude

Keep Codex responsible for research dialogue, synthesis, and epistemic judgment. Use the `claude_research` MCP tools to give implementation and independent audits to fresh Claude Code sessions. Do not make implementation edits directly while using this workflow; send corrections to the implementer session.

Read [experiment-trust.md](references/experiment-trust.md) before implementing or interpreting a consequential experiment.

## Establish the experiment contract

Do not delegate a vague research idea. First agree with the user on a compact contract containing:

- research question and claim the experiment could support;
- intervention or comparison and the relevant unit of analysis;
- outcomes, metrics, aggregation, and uncertainty estimates;
- baselines, controls, expected positive and negative patterns;
- known confounders, failure modes, and disconfirming outcomes;
- required artifacts and acceptance criteria.

Mark unresolved choices explicitly. Never let the implementer silently choose a scientifically meaningful default.

## Delegate implementation

Call `start` with persona `implementer`, model `opus`, the repository `cwd`, and a self-contained brief. Include the experiment contract, relevant paths, constraints, exact acceptance criteria, and verification commands.

Call `poll` with the returned job ID and cursor until it completes. Inspect the actual working tree, generated artifacts, and test output; do not rely only on the implementer's summary.

If implementation deviates from the contract or review finds defects, call `reply` on the same job. Preserve the original contract in the correction message and poll again.

## Run independent gates

Use fresh sessions so reviewers are not anchored by the implementer's reasoning. Give them the original contract and paths to the actual code and artifacts, not the implementer's self-assessment.

Before an expensive or conclusion-bearing run, use:

1. `code-reviewer` to find ordinary implementation bugs.
2. `experiment-auditor` to find design errors, confounding, leakage, hidden choices, and mismatches between the claim and implemented experiment.
3. `measurement-auditor` to validate metrics, denominators, masks, aggregation, instrumentation, and artifact completeness.
4. `falsifier` when alternative explanations would materially change the conclusion; ask for the cheapest decisive controls.

Start independent audits concurrently when their scopes do not overlap. Synthesize findings yourself. Ask the implementer to fix every critical issue and resolve or explicitly waive every high-severity issue with the user. Re-run affected audits after fixes.

## Interpret results

After the run, call a fresh `results-interpreter` with the experiment contract plus paths to raw outputs, resolved configuration, logs, and summaries. Require it to inspect evidence rather than accept a narrated result.

Classify the outcome as:

- **trustworthy signal**: implementation and validity gates passed and the evidence supports the bounded claim;
- **provisional signal**: informative, but a named uncertainty or missing control remains;
- **uninformative**: bugs, missing provenance, failed manipulation checks, inadequate power, or ambiguous measurement prevent interpretation.

Report what the experiment rules out, what it does not rule out, anomalies, reviewer disagreements, and the smallest next experiment that would reduce the main uncertainty. A null result is not evidence of absence unless the design had demonstrated power to detect the effect of interest.

## Tool discipline

- Use one job ID per independent agent and preserve cursors between `poll` calls.
- Use `reply` only to continue the same agent's assignment. Start a fresh job for independent review.
- Prefer Opus for implementation and all conclusion-bearing audits unless the user requests otherwise.
- Cancel obsolete jobs with `cancel`.
- Never fabricate agent findings while a job is running.
