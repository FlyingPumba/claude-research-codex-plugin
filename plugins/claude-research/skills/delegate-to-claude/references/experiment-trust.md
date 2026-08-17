# Experiment trust protocol

Use this protocol in proportion to the cost of a false conclusion. The objective is not maximal ceremony; it is preserving the chain from research claim to code to observable evidence.

Assurance work must follow, not replace, implementation progress. A larger number of agent reports does not increase confidence when the experiment's primary path is still a stub.

## Experiment contract template

```markdown
Question:
Bounded claim this run could support:
Competing explanations:

Intervention/comparison:
Unit of analysis:
Data/model population and exclusions:

Primary outcome:
Metric definition and aggregation:
Uncertainty estimate:
Manipulation check:

Baselines and controls:
Positive control:
Negative control:
Expected pattern if hypothesis is right:
Expected pattern if it is wrong:

Fixed choices:
Open choices requiring user agreement:
Known failure modes:
Acceptance criteria:
```

Acceptance criteria should describe the scientifically usable end-to-end path, not only modules, schemas, or plumbing. For training experiments, state how a cheap test demonstrates parameter updates, reward flow, checkpoint/resume, evaluation, and metric emission. Maintain a ledger mapping each criterion to code, tests, and current status; an omitted or placeholder item remains incomplete.

## Implementation completeness before audit fan-out

Before spending independent-review effort, verify that:

1. Every requested capability is present in the requirement ledger.
2. Standard components have an explicit reuse-versus-custom decision, with maintained libraries preferred for standard machinery.
3. The actual primary path is wired end to end; scripted stand-ins are labeled as such.
4. Required features contain no intentional placeholders or unconditional failure guards.
5. Cheap known-answer tests exercise semantic behavior, including an optimizer update when training is in scope.
6. Checkpoint/resume restores all scientifically relevant state when resumability is in scope.
7. Missing hardware, credentials, or large artifacts are separated from missing implementation. Mocked or tiny-model tests can establish code completeness, but not runtime validation on the target stack.

If this check fails, continue implementation. Do not launch multiple general audits of known-incomplete code.

## Provenance required for interpretable runs

Persist enough information to reproduce and diagnose the run:

- code revision plus uncommitted diff;
- fully resolved configuration, including defaults;
- random seeds and determinism settings;
- dataset, split, model, tokenizer, and checkpoint identifiers;
- relevant package and hardware versions;
- per-run and preferably per-example raw measurements;
- aggregate metrics derived from those raw measurements;
- stdout/stderr, exceptions, retries, skipped examples, and partial failures;
- start/end times and exit status.

Make missing or malformed inputs fail loudly. Record exclusions and missing values rather than silently dropping them. Do not overwrite prior runs.

## Pre-run validity checks

Trace each scientific choice into code and configuration. Check especially:

- train/test or prompt/evaluation leakage;
- selecting examples, layers, tokens, checkpoints, or seeds after seeing outcomes;
- accidental pairing or loss of pairing;
- pseudoreplication and correlated samples treated as independent;
- inconsistent preprocessing between conditions;
- hidden fallback paths, stale caches, and partially loaded checkpoints;
- device, dtype, padding, masking, indexing, and off-by-one mistakes;
- averaging over the wrong dimension or denominator;
- comparing unequal budgets or stopping conditions;
- multiple comparisons and unreported researcher degrees of freedom;
- absent positive controls or manipulation checks.

Require small synthetic or hand-checkable cases for important metric and data-path logic. Check invariants and expected directional behavior, not merely that the program exits successfully.

## Post-run interpretation checks

Before treating a number as evidence:

1. Confirm the intended intervention occurred.
2. Confirm controls and sanity checks behaved as expected.
3. Inspect run completeness, missingness, warnings, and anomalies.
4. Recompute headline aggregates from raw outputs when feasible.
5. Separate prespecified analyses from exploratory analyses.
6. Evaluate robustness across seeds, examples, reasonable analysis choices, and relevant subgroups.
7. Look for ceiling/floor effects, saturation, contamination, and metric gaming.
8. State the narrowest claim supported by the design.

Do not average away heterogeneous failures. Show distributions or per-seed results when aggregates can conceal instability.

## Assurance levels

- **Implementation task:** one implementer through ledger completion, then one fresh code review.
- **Exploratory experiment:** add experiment and measurement audits.
- **Conclusion-bearing or expensive experiment:** add falsification before the run and independent results interpretation afterward.
- **Surprising result:** repeat from a clean state, strengthen provenance, and seek a disconfirming test before updating strongly.
