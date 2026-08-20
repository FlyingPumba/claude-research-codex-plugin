# Claude Research Codex Plugin

Use Codex as the research interlocutor and local Claude Code agents as implementers and independent auditors.

The plugin is designed for research experiments where a plausible-looking result is not enough. It makes the implementation and review workflow explicit so that code bugs, silent experimental choices, invalid measurements, and alternative explanations are surfaced before a result is treated as meaningful evidence.

```text
you <-> Codex
          |
          +-- local stdio MCP --+-- implementer
                                +-- code reviewer
                                +-- experiment auditor
                                +-- measurement auditor
                                +-- falsifier
                                +-- results interpreter
                                      |
                                local Claude Code / Opus
```

Everything runs locally. The bundled MCP process launches the installed `claude` CLI directly; there is no hosted service, remote MCP endpoint, or shared credential store.

## What it provides

- A Codex skill for implementing and iterating on an agreed research experiment.
- An opt-in delegation gate plus separate implementation and experiment-execution approvals.
- An asynchronous local MCP wrapper around Claude Code.
- A shared policy layer containing the researcher's standing implementation and experiment-operation decisions.
- Explicit regression, primary-path, edge-case, known-answer, and smoke-test expectations.
- Continued implementation sessions for review feedback and fixes.
- Durable work-package records that survive MCP restarts and preserve the Claude session ID, brief, events, budgets, and requirement-ledger handoff.
- Required project-specific working directories and one canonical implementer session per work package.
- Per-turn wall-time and tool-call budgets, repeated-command detection, and warnings for test pipelines that can mask failures.
- Full Codex authority over delegated Claude workers, including cancellation, redirection, restart, and continuation without separate approval.
- Fresh, independent Claude sessions for audits where anchoring would be dangerous.
- Six research-oriented personas:

| Persona | Responsibility |
| --- | --- |
| `implementer` | Implements the agreed experiment and reports assumptions, deviations, tests, and artifacts. |
| `code-reviewer` | Looks for ordinary implementation bugs, edge cases, and untested failure paths. |
| `experiment-auditor` | Checks design validity, confounding, leakage, hidden choices, and claim/experiment mismatches. |
| `measurement-auditor` | Checks metrics, masks, denominators, aggregation, instrumentation, and artifact completeness. |
| `falsifier` | Develops competing explanations and proposes the cheapest decisive controls. |
| `results-interpreter` | Inspects raw evidence and classifies the outcome as trustworthy, provisional, or uninformative. |

## Requirements

- Codex with plugin and MCP support.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated locally.
- Node.js 20 or newer.
- Git for normal research-project workflows.

Verify the local dependencies:

```bash
codex --version
claude --version
node --version
```

## Install from this private repository

Your Git and SSH credentials must have access to the repository.

```bash
codex plugin marketplace add git@github.com:FlyingPumba/claude-research-codex-plugin.git
codex plugin add claude-research@claude-research-codex-plugin
```

Then restart Codex or begin a new conversation. Confirm that the bundled MCP is available:

```bash
codex mcp list
```

For local development, clone the repository and register its directory instead:

```bash
git clone git@github.com:FlyingPumba/claude-research-codex-plugin.git
cd claude-research-codex-plugin
codex plugin marketplace add "$PWD"
codex plugin add claude-research@claude-research-codex-plugin
```

The `marketplace add` command is a one-time registration step. The local marketplace points directly at this checkout, so you do not need to add it again after each edit.

### Reinstall after local changes

From the repository root, run:

```bash
# Give the changed plugin a fresh cache key.
python3 ~/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  plugins/claude-research

# Validate before installing. `uv` supplies the validator's PyYAML dependency.
uv run --with pyyaml python \
  ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  plugins/claude-research

# Reinstall the plugin from the already-registered local marketplace.
codex plugin add claude-research@claude-research-codex-plugin

# Confirm that Codex sees the plugin and bundled MCP.
codex plugin list
codex mcp list
```

You do not need to remove the previous installation or run `codex plugin marketplace upgrade` for this local-development setup. The cachebuster prevents Codex from reusing the prior installed copy. After reinstalling, start a new Codex conversation so it loads the updated skill and MCP tool definitions.

## Using it

Start the research discussion with Codex normally:

> I want to investigate whether [research question]. Help me design a trustworthy experiment.

Do not invoke the skill during ordinary research discussion or planning. When the contract and implementation plan are ready, approve the handoff explicitly:

> Use $delegate-to-claude to implement the experiment we agreed above.

The skill is scoped to implementing and iterating on research experiments, but it is never selected merely because an experiment needs implementation, tests, review, execution, or interpretation. The user must explicitly ask to use Claude, `$delegate-to-claude`, or the `claude-research` plugin in the current conversation. It does not apply to maintaining this plugin or to other non-experiment software work. It will not launch the full experiment until the separate execution-approval boundary is crossed.

Claude delegation and implementation approval are distinct. “Implement this,” “add tests,” “review this,” or approval of an experiment plan tells Codex what work to do; it does not authorize handing that work to Claude. A single instruction can cross both gates only when it explicitly does both, for example:

> Use $delegate-to-claude to implement the agreed experiment.

Before implementation, agree on:

- the claim the experiment could support;
- the intervention, comparison, and unit of analysis;
- metrics, aggregation, uncertainty, and expected patterns;
- baselines, controls, confounders, and disconfirming outcomes;
- required artifacts, acceptance criteria, and verification commands;
- every scientifically meaningful choice that must not be silently defaulted.

Example prompts:

> Help me turn this hypothesis into an experiment contract. Do not implement it yet.

> Use $delegate-to-claude to implement the agreed contract, then independently audit the implementation, design, and measurement.

> Before I launch this expensive run, use fresh reviewers to determine whether a positive or negative result would actually be interpretable.

> Inspect these raw outputs and resolved configs. Tell me whether this is a trustworthy signal, a provisional signal, or an uninformative run.

The enforced workflow is:

1. Codex and the researcher discuss and agree on the experiment contract without changing code.
2. The researcher explicitly opts into Claude delegation; the exact opt-in is recorded as `delegation_approval_quote` on every new Claude job.
3. The researcher explicitly approves implementation; the exact phase approval is recorded separately as `approval_quote` on the `implementation` job. One quote may fill both fields only when it explicitly authorizes both actions.
4. An `implementer` Claude session changes code and runs tests or cheap smoke checks, but cannot launch the full experiment. Subsequent milestones and corrections resume that same native Claude session.
5. Codex makes targeted spot-checks of the actual tree, diffs, artifacts, job records, and cheap semantic tests where they reduce uncertainty; scaffolds, stubs, and plumbing-only smoke paths keep the implementation phase open.
6. Once the primary path is complete, fresh reviewers are added in proportion to the next decision and only when the user's delegation scope covers them.
7. The implementer fixes critical findings and only affected gates are rerun.
8. Codex reports the gate status and asks for a separate approval to execute the full experiment.
9. A fresh `execution` job runs the frozen, audited contract without changing tracked experiment code.
10. A fresh `results-interpreter` inspects raw outputs, resolved configuration, logs, and summaries when Claude interpretation was explicitly requested.
11. Codex synthesizes the evidence and bounds the claim.

Implementation approval remains valid for the agreed work package. Codex should not repeatedly re-litigate or narrate that boundary; it returns to the user only for a materially expanded scope, an unresolved scientific choice, a destructive action, or approval of the consequential run.

Within an approved phase, Codex has full authority over every delegated Claude worker. It may cancel, redirect, restart, or continue jobs without asking for separate permission. This worker-lifecycle authority does not permit a new or repeated experiment execution without the corresponding execution approval.

Questions, hypotheticals, planning requests, and phrases such as “how would we” are not treated as approval. Repeating a full run requires a new execution approval.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `start` | Start an immutable `implementation`, `review`, `execution`, or `interpretation` phase with a required precise `cwd`, stable `work_package_id`, and exact `delegation_approval_quote` explicitly naming Claude or this plugin. Implementation and execution also require a distinct phase `approval_quote`. |
| `poll` | Stream new events from an asynchronous job until it reaches a terminal state. |
| `reply` | Resume the same persisted Claude Code session for implementation, review, or interpretation. It cannot repeat or extend an execution job. |
| `list` | List durable jobs loaded from disk, including sessions recoverable after an MCP restart. |
| `cancel` | Let Codex stop any running Claude worker immediately, recording an optional reason but requiring no separate user approval. |
| `personas` | List the available persona definitions. |

The default model is `opus` with `high` effort. Override these defaults with:

```bash
export CLAUDE_RESEARCH_MODEL=opus
export CLAUDE_RESEARCH_EFFORT=high
export CLAUDE_RESEARCH_CLAUDE_BIN=/path/to/claude
export CLAUDE_RESEARCH_MAX_WALL_TIME_MINUTES=60
export CLAUDE_RESEARCH_MAX_TOOL_CALLS=200
export CLAUDE_RESEARCH_STATE_DIR=/path/to/local/job-state
```

Each `start` creates a fresh native Claude Code session. Each `reply` launches a new CLI process with `--resume` and the original session ID, so implementation corrections retain the complete Claude transcript. The MCP stores atomic JSON job metadata plus append-only JSONL event logs under `~/.codex/claude-research/jobs` by default. If the MCP restarts, `list` reloads those records and `reply` continues the saved session. Starting a second implementer for the same `cwd` and `work_package_id` is rejected unless Codex explicitly names the previous job with `replace_job_id` and records why its native session is unrecoverable.

Budgets apply to each `start` or `reply` turn. The MCP emits a warning at 80% of the tool-call allowance and cancels after the configured tool-call or wall-time limit. It also emits policy warnings after three identical shell commands and when a test runner is piped through `head`, `tail`, `grep`, or `sed`, because those pipelines can hide the test runner's failing exit status.

Plugin-launched Claude workers do not inherit the shell's `CLAUDE_APPEND_SYSTEM_PROMPT` by default. The plugin supplies its own research policy and persona, avoiding conflicts with confirmation or process-control rules intended for personal interactive Claude use. Set `CLAUDE_RESEARCH_INHERIT_GLOBAL_PROMPT=1` only when inheriting that global prompt is deliberately desired.

The MCP exposes the exact plugin build version and a SHA-256 hash of the loaded persona/policy bundle in initialization and tool responses. This lets Codex detect a stale skill/server installation rather than silently using mismatched semantics.

## Security model

This plugin is intentionally configured for trusted local machines and disposable experiment environments. Every delegated Claude Code process runs with:

```text
--dangerously-skip-permissions
```

Claude can therefore read, modify, execute, and delete files accessible to the current user. Install this plugin only if that is the behavior you want, review the source first, and do not use it in an untrusted checkout or on a machine where those permissions are inappropriate.

The delegation and phase approval quotes are auditable workflow guardrails, not cryptographic authorization or a sandbox boundary. The MCP refuses every new job without an exact quote explicitly naming Claude, `claude-research`, or `delegate-to-claude`; implementation and execution require an additional phase approval quote. Codex is instructed not to infer or fabricate either. Once a Claude is explicitly delegated, Codex controls that worker's lifecycle; both agents still run in the deliberately permissive local environment described above.

No Claude or Anthropic credentials are included in this repository. Each user authenticates their own local Claude Code installation.

## Development

The MCP implementation uses only Node.js built-ins, so no package installation is required.

Run its tests:

```bash
cd plugins/claude-research/mcp
npm test
```

Validate the complete plugin with Codex's `plugin-creator` validator before distributing an update. For a checkout registered as a local marketplace, use the cachebuster and reinstall procedure in [Reinstall after local changes](#reinstall-after-local-changes).

If instead you installed the marketplace from the private Git repository and are not editing a local checkout, refresh that remote-backed marketplace and reinstall with:

```bash
codex plugin marketplace upgrade claude-research-codex-plugin
codex plugin add claude-research@claude-research-codex-plugin
```

Start a new Codex conversation after reinstalling so updated skills and MCP tools are loaded.

## Repository layout

```text
.agents/plugins/marketplace.json       private marketplace catalog
plugins/claude-research/
  .codex-plugin/plugin.json            plugin manifest
  .mcp.json                            bundled local MCP configuration
  mcp/                                 Claude Code wrapper and tests
  policies/research-decisions.md       standing decisions shared by every persona
  personas/                            independent agent prompts
  skills/delegate-to-claude/           Codex orchestration workflow
```
