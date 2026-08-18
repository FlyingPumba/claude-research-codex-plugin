---
name: delegate-to-claude
description: Implement and iterate on AI-safety research experiments through explicitly approved local Claude Code/Opus implementation, independent audits, separately approved execution, and evidence-based interpretation. Use only for work on research experiment code or runs, such as implementing or revising an agreed experiment, auditing its implementation or validity, executing it, controlling an active experiment job, or interpreting its results. Do not use for ordinary research discussion or planning, hypothetical implementation questions, plugin development or maintenance, or other non-experiment software work.
---

# Delegate to Claude

Keep Codex responsible for research dialogue, synthesis, and epistemic judgment. Use the `claude_research` MCP tools to give implementation and independent audits to Claude Code sessions. Do not make experiment implementation edits directly while using this workflow; send corrections to the implementer session.

Codex is explicitly empowered to inspect the working tree, diffs, generated artifacts, logs, job records, and focused test outcomes at any point where a spot-check would reduce uncertainty or avoid wasted work. Use targeted inspections at handoffs, after surprising output, before expensive review, and when inheriting a partially implemented checkout. Do not mechanically reread every file after every Claude turn or duplicate a full independent audit. In a mid-progress project, inspect enough of the current state to identify the concrete remaining delta before delegating or resuming work.

## Stay within research experiments

Apply this workflow only to implementing, revising, auditing, running, controlling, or interpreting a research experiment. Handle development, maintenance, testing, validation, release, and reinstallation of this plugin directly in Codex. Handle other non-experiment software work through the normal Codex workflow.

## Keep discussion implicit

Treat ordinary research discussion and planning as normal Codex dialogue, not activation of this skill. Answer the research substance directly. If the skill was explicitly invoked before implementation approval, do not repeatedly restate the phase, the lack of authorization, or the absence of a Claude job. Ask once for implementation approval when the experiment contract and plan are ready.

Once the user has approved implementation, treat that approval as durable for the agreed scope. A later explicit request to add or change an implementation feature is itself approval for that change; do not ask for a redundant confirmation. Do not repeatedly re-check, narrate, or ask about the implementation boundary. Revisit authorization only when the requested action materially expands the experiment without an explicit command, launches a consequential run, is destructive, or otherwise crosses a distinct approval boundary.

Once any Claude job is delegated, Codex has full operational authority over that worker. Cancel, redirect, restart, or continue Claude jobs whenever useful to complete the approved work, avoid redundant cost, recover from mistakes, or enforce the contract. Do not ask the user for separate permission to manage a Claude, including an execution-phase Claude. Worker control does not authorize launching or repeating an experiment, changing its scientific contract, or expanding the approved work package.

Read [experiment-trust.md](references/experiment-trust.md) before implementing or interpreting a consequential experiment. Do not read it merely to establish the workflow phase or answer ordinary planning questions.

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

Turn the accepted plan into a requirement ledger before delegation. The ledger must enumerate every user-requested capability, the expected code path or artifact, and an observable acceptance check. Include a dependency strategy that says which maintained libraries provide standard machinery and which experiment-specific glue must be custom. Prefer existing, well-supported libraries for standard training, modeling, checkpointing, and tracking components; write custom code only where the research design actually differs. An approved plan that explicitly names a library or library family counts as approval to use it.

Ask the user to approve the contract and implementation plan. Until the response contains explicit authorization, remain in discussion and do not call the Claude MCP.

## Optimize for research-grade correctness

Build the smallest complete system that can execute the agreed experiment and support a trustworthy interpretation. Research-grade means scientifically faithful, tested at conclusion-sensitive seams, observable, reproducible enough for the claim, and recoverable enough not to waste an expensive run. It does not mean production-grade generality.

Do not request or accept generic frameworks, plugin architectures, deployment systems, user interfaces, broad compatibility layers, speculative abstractions, or operational hardening unless the experiment contract directly requires them. “Smallest” does not mean mocked, scripted, or incomplete: the primary path must use the real model, data, optimization, measurements, and artifacts required by the experiment. Experiment-specific complexity is justified when the research design needs it; generality for hypothetical future experiments is not.

Before adding a requirement or accepting a reviewer request, ask:

1. Is it required to run the frozen experiment?
2. Could its failure change the scientific conclusion or waste an expensive run?
3. Is it required to reproduce, diagnose, or interpret the result?
4. What is the cheapest decisive check for it?

If the answer to the first three questions is no, defer it. Classify work by research risk:

- **P0 — conclusion validity:** data leakage, wrong rewards, masks, denominators, grouping, sampling or log-probability mismatch, optimizer mistakes, invalid controls, or anything else that could reverse or invalidate the conclusion. Resolve before execution.
- **P1 — run usability:** checkpointing, raw artifacts, provenance, failure visibility, and bounded recovery needed to avoid losing the run or making it uninterpretable. Implement the portion needed by the agreed run.
- **P2 — engineering convenience:** extensibility, cleanup, deployment, production security, multi-platform support, generalized APIs, and polish. Defer unless explicitly required by the contract.

Concentrate verification on conclusion-sensitive seams rather than maximizing code coverage. Prefer small known-answer fixtures and semantic invariants for rewards, masks, splits, updates, checkpoint restoration, and metric aggregation. Escalate evidence cost in order: hand-checkable unit cases, real vertical integration with a tiny model or dataset, short training smoke, small pilot, then the full run. Do not advance while a cheaper gate is failing.

Before execution, define manipulation checks, health indicators, and stop conditions that would make the run uninformative. Make missing data, silent fallbacks, dropped examples, partial loads, NaNs, reward degeneracy, and monitor collapse visible. Freeze the conclusion-bearing code, resolved configuration, data/model identifiers, seeds, command, and analysis definitions. Record changes made after seeing outcomes as exploratory rather than silently treating them as part of the original test.

At every milestone, distinguish “needed for a valid experiment” from “nice engineering.” Challenge both an implementer's desire to broaden the system and a reviewer's production-quality requests unrelated to the scientific claim. Stop implementation when the evidence contract is satisfied; do not keep refactoring merely because the code could be cleaner or more reusable.

## Delegate implementation

Before the first job in a workflow, call `personas` once and inspect its runtime metadata. If the reported plugin build does not match the installed skill or manifest version, stop and report the stale installation instead of operating with mismatched tool semantics.

Choose a stable, concise `work_package_id` for the agreed implementation and use it for all related implementation, review, execution, and interpretation jobs. Resolve `cwd` to the most specific directory containing the research project. For a nested project, never use the monorepo root merely because it is the Git root.

After explicit implementation approval, call `start` with phase `implementation`, persona `implementer`, the exact `approval_quote`, model `opus`, the precise project `cwd`, the stable `work_package_id`, and a self-contained brief. Include the experiment contract, requirement ledger, relevant paths, constraints, exact acceptance criteria, library-reuse decisions, and verification commands. State that the full experiment is not authorized. Respect any ownership split the user requested, such as reserving research prose or contract documents for Codex.

Call `poll` with the returned job ID and cursor until it completes. Inspect the actual working tree, generated artifacts, and test output; do not rely only on the implementer's summary.

Use the same implementer job until its work package is complete. The MCP persists its Claude session and job record across server restarts. After a restart, call `list`, locate the work package, inspect its status and ledger, and use `reply` to resume it. If implementation deviates from the contract, leaves required paths as stubs, or review later finds defects, call `reply` on that job with one consolidated correction message. Preserve the original contract and ledger in the correction. Do not start replacement implementers merely because the first pass is incomplete. Use `replace_job_id` plus a concrete `replacement_reason` only when the native Claude session is genuinely unrecoverable; the MCP otherwise rejects a second implementation job for the same work package.

Treat each Claude turn as a bounded milestone. Use the default wall-time and tool-call budgets unless the agreed task clearly needs different limits. When polling surfaces `budget_warning`, `policy_warning`, repeated commands, or no meaningful progress, inspect the relevant evidence and either send focused feedback after completion or cancel the worker promptly. A high reasoning effort is compatible with bounded milestones; do not lower effort merely to compensate for an ill-scoped assignment.

Before starting independent review jobs, perform an implementation-completeness check against the ledger. At minimum:

- every contract-required primary path exists and is constructible;
- no required capability is represented only by `NotImplementedError`, a fail-fast placeholder, or a scripted substitute;
- a real training step changes the intended trainable parameters in a small or mocked test;
- checkpoint/resume round-trips the state required by the agreed design;
- metrics and artifacts are emitted by the real primary path, not only a plumbing smoke path;
- the relevant test suite and a cheap end-to-end smoke check pass, or environmental validation gaps are named precisely.

Do not call a scaffold, interface layer, or plumbing-only smoke result a completed implementation. Report it as partial and continue the implementer session. Do not let documentation, generic hardening, or additional review activity displace missing core experiment code.

## Run independent gates

Use fresh sessions so reviewers are not anchored by the implementer's reasoning. Give them the original contract and paths to the actual code and artifacts, not the implementer's self-assessment.

Call `start` with phase `review`, the same `work_package_id`, and the precise project `cwd` for each selected reviewer. Review jobs do not require `approval_quote`, cannot edit tracked implementation files, and cannot launch the full experiment.

Right-size review to the next decision. Do not fan out reviewers while the implementation-completeness check is failing. For an implementation handoff, one fresh code review is normally sufficient. Add design and measurement audits when preparing an exploratory run; use the full set only for an expensive, conclusion-bearing, or otherwise high-consequence run. An early reviewer is appropriate only for a narrowly identified design risk whose answer will change the implementation, not as a substitute for finishing it.

Before an expensive or conclusion-bearing run, use:

1. `code-reviewer` to find ordinary implementation bugs.
2. `experiment-auditor` to find design errors, confounding, leakage, hidden choices, and mismatches between the claim and implemented experiment.
3. `measurement-auditor` to validate metrics, denominators, masks, aggregation, instrumentation, and artifact completeness.
4. `falsifier` when alternative explanations would materially change the conclusion; ask for the cheapest decisive controls.

Start independent audits concurrently when their scopes do not overlap. Synthesize findings yourself and deduplicate overlapping comments before sending a consolidated fix request. Ask the implementer to fix every critical issue and resolve or explicitly waive every high-severity issue with the user. Re-run only the audits affected by those fixes; do not repeat unchanged gates for reassurance.

## Approve and execute the run

Report the resolved and unresolved gate findings before execution. Ask for separate explicit approval to launch the full, expensive, or conclusion-bearing run. Implementation approval does not count as execution approval.

After execution approval, start a new job with phase `execution`, persona `implementer`, the same `work_package_id`, the precise project `cwd`, and the new exact `approval_quote`. Give it the frozen contract, command, resolved configuration, artifact paths, and monitoring requirements. Do not use `reply` to turn an implementation job into execution. Do not let the execution job edit tracked experiment code; if a change is needed, return to implementation and repeat affected gates.

A retry or materially repeated full run requires a new execution approval and a fresh `start` job.

## Interpret results

After the run, call `start` with phase `interpretation`, the same `work_package_id`, the precise project `cwd`, and a fresh `results-interpreter`, passing the experiment contract plus paths to raw outputs, resolved configuration, logs, and summaries. Require it to inspect evidence rather than accept a narrated result.

Classify the outcome as:

- **trustworthy signal**: implementation and validity gates passed and the evidence supports the bounded claim;
- **provisional signal**: informative, but a named uncertainty or missing control remains;
- **uninformative**: bugs, missing provenance, failed manipulation checks, inadequate power, or ambiguous measurement prevent interpretation.

Report what the experiment rules out, what it does not rule out, anomalies, reviewer disagreements, and the smallest next experiment that would reduce the main uncertainty. A null result is not evidence of absence unless the design had demonstrated power to detect the effect of interest.

## Tool discipline

- Use one job ID per independent agent and preserve cursors between `poll` calls.
- Treat the persisted job record reported as `state_file` as recovery evidence, not as a substitute for inspecting the actual project artifacts.
- Optimize for completed acceptance criteria, not agent turns, reports, or review count. Keep the number of jobs proportional to the decision being made.
- Treat a job's phase as immutable. Use `reply` only within implementation, review, or interpretation. Start a fresh job for independent review or any execution.
- Prefer Opus for implementation and all conclusion-bearing audits unless the user requests otherwise.
- Use `cancel` at your own discretion for redundant, mistaken, blocked, runaway, or no-longer-useful Claude jobs. Give a concise `reason`; never ask the user to authorize worker lifecycle management.
- Respond to `masked_test_exit_status` warnings by requiring one unpiped test invocation with its exact exit status; do not accept a downstream `head`, `tail`, `grep`, or `sed` status as a test result.
- Never fabricate agent findings while a job is running.
