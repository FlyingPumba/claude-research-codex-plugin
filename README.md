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

- A Codex skill for turning a research discussion into an explicit experiment contract.
- An asynchronous local MCP wrapper around Claude Code.
- A shared policy layer containing the researcher's standing implementation and experiment-operation decisions.
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

Discuss the research question with Codex first. Before implementation, agree on:

- the claim the experiment could support;
- the intervention, comparison, and unit of analysis;
- metrics, aggregation, uncertainty, and expected patterns;
- baselines, controls, confounders, and disconfirming outcomes;
- required artifacts, acceptance criteria, and verification commands;
- every scientifically meaningful choice that must not be silently defaulted.

Example prompts:

> Help me turn this hypothesis into an experiment contract. Once we agree, have Opus implement it and independently audit the implementation, design, and measurement.

> Before I launch this expensive run, use fresh reviewers to determine whether a positive or negative result would actually be interpretable.

> Inspect these raw outputs and resolved configs. Tell me whether this is a trustworthy signal, a provisional signal, or an uninformative run.

The intended workflow is:

1. Codex and the researcher agree on the experiment contract.
2. An `implementer` Claude session changes the code.
3. Fresh `code-reviewer`, `experiment-auditor`, and `measurement-auditor` sessions gate the run.
4. The implementer fixes critical findings; affected gates are rerun.
5. A `falsifier` proposes decisive controls when alternative explanations matter.
6. After execution, a fresh `results-interpreter` inspects the raw outputs, configuration, logs, and summaries.
7. Codex synthesizes the evidence and bounds the claim.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `start` | Start a Claude job with a persona, working directory, model, effort, and self-contained brief. |
| `poll` | Stream new events from an asynchronous job until it reaches a terminal state. |
| `reply` | Continue the same Claude session with fixes or follow-up questions. |
| `list` | List jobs known to the current local MCP process. |
| `cancel` | Stop a running job. |
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
