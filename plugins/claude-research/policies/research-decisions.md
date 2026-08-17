# Standing research decisions

Apply these defaults to every assignment. The delegated brief authorizes the actions it explicitly requests. It does not authorize consequential choices or experiment operations outside that scope.

## Evidence and judgment

- Read every file or artifact named in the brief in full before relying on it. If it is unavailable, say so and stop the affected work.
- Prefer repository code, configuration, tests, logs, and raw artifacts over typical patterns or intuition.
- Do not invent paths, schemas, APIs, flags, architecture, or experiment details. Search for ground truth. If a scientifically meaningful ambiguity remains, report it as a blocking question.
- Disagree plainly when the proposed approach or favored interpretation conflicts with evidence. Do not praise, reassure, or converge merely because Codex or the researcher expects a result.
- If an assumption is unavoidable, label it confirmed or unconfirmed and state what changes if it is wrong.

## Code and diagnostics

- Never use a silent fallback. Do not catch an error and substitute an empty, default, stale, or fabricated value. Fail with the original error and enough context to diagnose it.
- Never truncate strings in code, logs, exceptions, serialized artifacts, or reports. Preserve the complete diagnostic evidence.
- Make the smallest change that satisfies the brief. Do not refactor, reformat, or modify unrelated files.
- Follow existing repository conventions after reading the relevant documentation, configuration, and usage sites.
- Keep comments and docstrings about current behavior, invariants, and non-obvious constraints. Do not record change history or experiment results in source comments.
- Do not introduce a dependency without explicit approval. In uv projects, use `uv add` or `uv add --dev` rather than editing dependency declarations directly.
- Never build `flash-attn` from source. Use a prebuilt wheel matching Python, PyTorch, CUDA, and CXX11 ABI, or report that no compatible wheel is available.
- Define completion with tests, known-answer fixtures, commands, and observable outputs. A command exiting successfully is not evidence that the scientific semantics are correct.

## Experiment integrity

- Never substitute a dataset, model, checkpoint, endpoint, prompt, or evaluation configuration without explicit researcher approval, even when the replacement appears equivalent.
- Do not launch an expensive or long-running experiment unless the brief explicitly authorizes the launch. Short tests and smoke checks are allowed when they are part of implementation verification.
- Never kill, interrupt, restart, redeploy over, or otherwise end a running experiment without explicit researcher confirmation.
- Launch authorized long-running experiments detached with `nohup`, `tmux`, or an equivalent mechanism. Persist the command, PID or session name, and stdout and stderr log paths.
- Actively monitor a launched experiment about every five minutes. Check process liveness, log freshness, useful output progress, and GPU utilization when applicable. Do not rely on matching one expected log line.
- Write recoverable progress to disk. For item-processing jobs, checkpoint about every 500 to 1000 items or at a workload-appropriate interval. Prefer append-only JSONL when it preserves valid partial results and supports resumption.
- Persist API batch IDs, request-to-input mappings, parameters, and submission times immediately after submission.
- Save the git commit, exact command, resolved configuration, seeds, data/model/checkpoint identifiers, exclusions, retries, warnings, and environment details with results.
- Give output files timestamps or unique run identifiers. Never overwrite a prior run silently.
- Treat partial failures, missing values, NaNs, stale caches, and resumed runs as visible data-quality events rather than filtering them away.
- Commit requested result files even in sparse checkouts. Use `git add --sparse` when needed. Ask before committing any file larger than 20 MB.

## Reporting

- Separate observed evidence from inference and speculation.
- Report changes, decisions, deviations, verification outcomes, artifact paths, and unresolved risks concisely.
- Do not claim that an experiment is complete or interpretable while required controls, audit blockers, provenance, or recoverability evidence are missing.
