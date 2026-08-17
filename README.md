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
- A discussion-first state machine with separate implementation and experiment-execution approvals.
- An asynchronous local MCP wrapper around Claude Code.
- A shared policy layer containing the researcher's standing implementation and experiment-operation decisions.
- Explicit regression, primary-path, edge-case, known-answer, and smoke-test expectations.
- Continued implementation sessions for review feedback and fixes.
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

## Using it

Start the research discussion with Codex normally:

> I want to investigate whether [research question]. Help me design a trustworthy experiment.

Do not invoke the skill during ordinary research discussion or planning. When the contract and implementation plan are ready, approve the handoff explicitly:

> Use $delegate-to-claude to implement the experiment we agreed above.

The skill is scoped to implementing and iterating on research experiments. It does not apply to maintaining this plugin or to other non-experiment software work. It will not launch the full experiment until the separate execution-approval boundary is crossed.

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
2. The researcher explicitly approves implementation; the exact approval is attached to a new `implementation` job.
3. An `implementer` Claude session changes code and runs tests or cheap smoke checks, but cannot launch the full experiment.
4. Fresh `code-reviewer`, `experiment-auditor`, and `measurement-auditor` jobs gate the run. A `falsifier` adds decisive controls when alternative explanations matter.
5. The implementer fixes critical findings and affected gates are rerun.
6. Codex reports the gate status and asks for a separate approval to execute the full experiment.
7. A fresh `execution` job runs the frozen, audited contract without changing tracked experiment code.
8. A fresh `results-interpreter` inspects raw outputs, resolved configuration, logs, and summaries.
9. Codex synthesizes the evidence and bounds the claim.

Questions, hypotheticals, planning requests, and phrases such as “how would we” are not treated as approval. Repeating a full run requires a new execution approval. Cancelling a running Claude job also requires explicit authorization.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `start` | Start an immutable `implementation`, `review`, `execution`, or `interpretation` phase. Implementation and execution require an exact user approval quote. |
| `poll` | Stream new events from an asynchronous job until it reaches a terminal state. |
| `reply` | Continue an implementation, review, or interpretation session. It cannot repeat or extend an execution job. |
| `list` | List jobs known to the current local MCP process. |
| `cancel` | Stop a running job after recording the user's exact cancellation authorization. |
| `personas` | List the available persona definitions. |

The default model is `opus` with `high` effort. Override these defaults with:

```bash
export CLAUDE_RESEARCH_MODEL=opus
export CLAUDE_RESEARCH_EFFORT=high
export CLAUDE_RESEARCH_CLAUDE_BIN=/path/to/claude
```

## Security model

This plugin is intentionally configured for trusted local machines and disposable experiment environments. Every delegated Claude Code process runs with:

```text
--dangerously-skip-permissions
```

Claude can therefore read, modify, execute, and delete files accessible to the current user. Install this plugin only if that is the behavior you want, review the source first, and do not use it in an untrusted checkout or on a machine where those permissions are inappropriate.

The approval quote is an auditable workflow guardrail, not cryptographic authorization or a sandbox boundary. Codex is instructed not to infer or fabricate it, and the MCP refuses approval-sensitive calls when it is absent; both agents still run in the deliberately permissive local environment described above.

No Claude or Anthropic credentials are included in this repository. Each user authenticates their own local Claude Code installation.

## Development

The MCP implementation uses only Node.js built-ins, so no package installation is required.

Run its tests:

```bash
cd plugins/claude-research/mcp
npm test
```

Validate the complete plugin with Codex's `plugin-creator` validator before distributing an update. After pulling an update, refresh the marketplace and reinstall the plugin:

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
