# Optional LLM Adjudication Methodology

## Status

**Final recommendation: `DISABLE_BY_DEFAULT`**

Live LLM adjudication was not evaluated because it was optional to the core assignment and would require a paid external API. The deterministic accepted edges remain the source of truth. The adjudication pipeline is retained as an optional, disabled extension with dry-run, validation, and mock-test support.

This conclusion does not prove that LLM adjudication is ineffective. It means there is insufficient live evidence to enable it safely.

## Purpose

The core assignment is to build a high-quality, parameter-level dependency graph for the GitHub and Google Super toolkits.

The deterministic matching pipeline already produces the graph relationships required by the assignment. Phase 4 was implemented only as an optional experiment for evaluating whether an LLM could resolve some candidates that remain uncertain after deterministic evaluation.

The optional adjudicator does not replace deterministic accepted or rejected decisions.

## Deterministic Source of Truth

Final graph assembly must use:

```text
data/candidates.accepted.json
```

The frozen Phase 3 results are:

```text
Normalized tools: 1,360
Generated candidates: 148,598
Accepted: 6,456
Uncertain: 25,150
Rejected: 116,992
```

The 6,456 deterministically accepted candidates remain the source of truth for final graph construction.

The 116,992 rejected candidates remain rejected.

Phase 4 does not modify either frozen artifact.

## Phase 3 Evaluation

The reviewed Phase 3 fixture contains:

```text
Positive cases: 20
Negative cases: 20
Ambiguous cases: 10
Total cases: 50
```

Verified fixture results:

```text
Generated cases: 50 of 50
Decision matches: 50 of 50
Primary-reason matches: 50 of 50
Workflow-flag matches: 50 of 50
False positives: 0
False negatives: 0
Ambiguous cases incorrectly accepted: 0
```

These results describe the reviewed fixture only. They do not prove perfect performance across all generated candidates.

## Independent Phase 4 Holdout

Phase 4 uses an independent frozen holdout:

```text
tests/fixtures/adjudication-holdout.json
```

The holdout contains:

```text
Total cases: 40
GitHub cases: 20
Google Super cases: 20
Expected ACCEPT: 29
Expected REJECT: 4
Expected ABSTAIN: 7
```

The holdout has no exact candidate overlap with the Phase 3 evaluation fixture.

Expected decisions and human rationales are used only for offline scoring. They are not inserted into prompts or copied into the pilot manifest.

## Eligibility Filtering

The 25,150 uncertain candidates are filtered before optional adjudication.

Latest eligibility results:

```text
Uncertain candidates: 25,150
Eligible before semantic deduplication: 9,074
Retained after semantic deduplication: 5,539
```

Final eligibility categories:

```text
ELIGIBLE: 5,539
INELIGIBLE_INSUFFICIENT_EVIDENCE: 1,521
INELIGIBLE_DUPLICATE: 3,535
INELIGIBLE_LOW_VALUE: 14,555
INELIGIBLE_HARD_CONFLICT: 0
```

The 5,539 retained candidates represent a possible experimental universe only. They are not approved for a full external-model run.

## Holdout Eligibility Audit

All 40 frozen holdout candidates have eligibility assessments.

Results:

```text
Retained as ELIGIBLE: 22
INELIGIBLE_LOW_VALUE: 13
INELIGIBLE_INSUFFICIENT_EVIDENCE: 5
Missing assessments: 0
```

The leakage-free holdout pilot manifest contains only the 22 retained candidates:

```text
GitHub: 12
Google Super: 10
```

The manifest excludes:

* Expected decisions
* Expected dependency kinds
* Expected selection flags
* Expected disambiguation flags
* Expected transformation flags
* Human rationales

## Request Contract

Each adjudication request contains exactly one candidate.

The request is limited to stored evidence from:

* The uncertain candidate
* The producer tool
* The consumer tool
* The exact producer output path
* The exact consumer input path
* Canonical entities
* JSON types
* Scope requirements
* Deterministic reason codes
* Selection requirements
* Disambiguation requirements
* Transformation requirements

Raw toolkit schema fragments are not inserted into the prompt.

The prompt instructs the model not to rely on outside API knowledge.

## Allowed Output

The strict response schema permits only:

```text
ACCEPT
REJECT
ABSTAIN
```

An adjudication `ACCEPT` means that the relationship is supported by the supplied evidence. It does not mean that the relationship is formally verified or runtime-proven.

The model is not allowed to return a numeric confidence score.

The response also records:

* Dependency kind
* Whether selection is required
* Whether disambiguation is required
* Whether transformation is required
* Evidence references
* Reason codes
* A short explanation

## Response Validation

Responses must be exactly one JSON object that satisfies the strict Zod schema.

The validation layer detects or rejects:

```text
INVALID_JSON
NON_JSON_CONTENT
SCHEMA_VALIDATION_FAILED
CANDIDATE_ID_MISMATCH
UNKNOWN_TOOL_REFERENCE
UNKNOWN_PATH_REFERENCE
UNKNOWN_ENTITY_REFERENCE
UNKNOWN_SCOPE_REFERENCE
UNKNOWN_EVIDENCE_REFERENCE
EXTERNAL_KNOWLEDGE_USED
DETERMINISTIC_HARD_RULE_CONFLICT
UNSUPPORTED_TRANSFORMATION
MISSING_EVIDENCE
COLLECTION_SELECTION_IGNORED
DISAMBIGUATION_IGNORED
```

Responses with surrounding prose are rejected.

Invalid responses are not cached as valid decisions.

## Identity-Integrity Checks

The validation layer protects against known identity conflations, including:

* Gmail message ID versus thread ID
* Calendar ID versus event ID
* Calendar watch-channel ID versus calendar or event ID
* Drive watch-channel ID versus file ID
* Workflow ID versus workflow-run ID
* Workflow-run ID versus workflow-run number
* GitHub job ID versus workflow-run ID
* REST resource ID versus GraphQL node ID
* Release ID versus release-asset ID
* Issue number versus pull-request number
* Drive file ID versus comment ID
* A single scalar value versus a required composite expression

## Offline Client and Runner Architecture

The optional client architecture supports:

* Explicit model selection
* Environment-only credential loading
* Timeouts
* Limited retries
* Retryable and non-retryable failures
* Deterministic cache identities
* Cache invalidation by model and prompt version
* Persisted progress
* Resume behavior
* Explicit candidate limits
* Explicit request limits
* A maximum pilot size of 40
* Dry-run execution with zero network requests

Live execution is not the default.

The live path exists only as an optional extension and was tested with mocks rather than an external API.

## Dry-Run Verification

The full 22-candidate holdout manifest was executed through the dry-run path.

Verified result:

```text
Selected candidates: 22
Terminal dry-run results: 22
Completed model decisions: 0
Transport requests: 0
Live LLM requests: 0
Failures: 0
```

The dry-run report was also processed by the offline scorer:

```text
Valid decisions: 0
Dry-run results: 22
Missing results: 0
Unsupported ACCEPT decisions: 0
Safety gate passed: false
```

The safety gate correctly fails for dry runs because no real model decisions exist.

## Safety Gate

A hypothetical live pilot would pass the safety gate only if:

* Every selected candidate has a valid decision
* There are zero unsupported `ACCEPT` decisions
* There are no invalid responses
* There are no transport failures
* There are no dry-run placeholders
* There are no missing results

Unsupported `ACCEPT` decisions are treated as the highest-priority failure because they could add incorrect graph edges.

## Live Evaluation Status

No live OpenRouter or other external LLM request was made.

The following were not measured:

* Live model decision accuracy
* ACCEPT precision
* ACCEPT recall
* REJECT accuracy
* ABSTAIN quality
* Dependency-kind accuracy
* Workflow-flag accuracy
* Graph coverage improvement
* Cost per candidate
* Consistency across repeated requests

No claim should be made that LLM adjudication improved precision, recall, coverage, or planning quality.

## Final Recommendation

```text
DISABLE_BY_DEFAULT
```

Reasons:

1. The deterministic graph is sufficient for the original assignment.
2. Phase 3 accepted edges already provide the reviewed graph foundation.
3. Live adjudication would require a paid external API.
4. No live evidence exists.
5. Enabling the extension without evidence could introduce unsupported edges.
6. The offline implementation is retained for future explicitly authorized experiments.

## Final Graph Policy

Final graph assembly must use the 6,456 deterministic accepted candidates.

Phase 4 decisions are not required for final graph construction.

Uncertain relationships should remain unresolved unless downstream planning explicitly handles them by:

* Asking the user for a missing value
* Selecting an item from a collection
* Resolving a contact or email address
* Splitting a repository `full_name`
* Distinguishing an issue from a pull request
* Confirming runtime scope equality

These planning steps must preserve uncertainty rather than silently converting uncertain candidates into accepted graph edges.

## Verification

Final verified offline Phase 4 regression:

```text
TypeScript type-check: passed
Adjudication tests: 80 passed
Failures: 0
Assertions: 715
Test files: 12
Live LLM requests made: 0
```
