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
4. Codex checks every requirement against the actual tree and cheap semantic tests; scaffolds, stubs, and plumbing-only smoke paths keep the implementation phase open.
5. Once the primary path is complete, fresh reviewers are added in proportion to the next decision: code review for implementation, design and measurement audits for exploratory runs, and falsification for conclusion-bearing runs where alternatives matter.
6. The implementer fixes critical findings and only affected gates are rerun.
7. Codex reports the gate status and asks for a separate approval to execute the full experiment.
8. A fresh `execution` job runs the frozen, audited contract without changing tracked experiment code.
9. A fresh `results-interpreter` inspects raw outputs, resolved configuration, logs, and summaries.
10. Codex synthesizes the evidence and bounds the claim.

Implementation approval remains valid for the agreed work package. Codex should not repeatedly re-litigate or narrate that boundary; it returns to the user only for a materially expanded scope, an unresolved scientific choice, a destructive action, or approval of the consequential run.

Within an approved phase, Codex has full authority over every delegated Claude worker. It may cancel, redirect, restart, or continue jobs without asking for separate permission. This worker-lifecycle authority does not permit a new or repeated experiment execution without the corresponding execution approval.

Questions, hypotheticals, planning requests, and phrases such as “how would we” are not treated as approval. Repeating a full run requires a new execution approval.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `start` | Start an immutable `implementation`, `review`, `execution`, or `interpretation` phase. Implementation and execution require an exact user approval quote. |
| `poll` | Stream new events from an asynchronous job until it reaches a terminal state. |
| `reply` | Continue an implementation, review, or interpretation session. It cannot repeat or extend an execution job. |
| `list` | List jobs known to the current local MCP process. |
| `cancel` | Let Codex stop any running Claude worker immediately, recording an optional reason but requiring no separate user approval. |
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

The approval quote is an auditable workflow guardrail for starting implementation and execution phases, not cryptographic authorization or a sandbox boundary. Codex is instructed not to infer or fabricate it, and the MCP refuses those phase-transition calls when it is absent. Once a Claude is delegated, Codex controls that worker's lifecycle; both agents still run in the deliberately permissive local environment described above.

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
