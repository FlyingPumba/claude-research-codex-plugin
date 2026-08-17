# Experiment trust protocol

Use this protocol in proportion to the cost of a false conclusion. The objective is not maximal ceremony; it is preserving the chain from research claim to code to observable evidence.

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

- **Implementation task:** implementer plus code review.
- **Exploratory experiment:** add experiment and measurement audits.
- **Conclusion-bearing or expensive experiment:** add falsification before the run and independent results interpretation afterward.
- **Surprising result:** repeat from a clean state, strengthen provenance, and seek a disconfirming test before updating strongly.
