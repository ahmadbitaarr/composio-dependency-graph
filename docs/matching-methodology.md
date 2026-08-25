# Deterministic Dependency Matching Methodology

## Scope

This phase builds and validates dependency candidates for the Google Super and GitHub toolkits. It uses normalized tool schemas, canonical entities, ontology hard separations, schema safety evidence, and deterministic rules. No language model is used.

## Inputs

The matcher reads:

- `data/normalized-tools.json`
- `data/ontology.json`
- `tests/fixtures/dependency-cases.json`

The reviewed fixture contains 20 positive, 20 negative, and 10 ambiguous examples using exact tool slugs and exact normalized JSON paths.

## Candidate generation

Candidate generation is indexed rather than an unrestricted output-to-input Cartesian product.

### Exact canonical candidates

Safe, high-confidence canonical output fields are indexed by canonical entity and matched to required canonical input fields. JSON scalar types must be compatible.

Examples include:

- Gmail thread ID to Gmail thread ID
- Calendar event ID to Calendar event ID
- GitHub workflow-run ID to workflow-run ID
- GitHub release-asset ID to release-asset ID

### Hard-separation candidates

The ontology defines identity pairs that must not be conflated, such as:

- Gmail thread ID versus message ID
- Calendar ID versus event ID
- GitHub workflow ID versus workflow-run ID
- GitHub workflow-run ID versus job ID
- GitHub REST repository ID versus GraphQL repository node ID
- GitHub release ID versus release-asset ID
- GitHub commit SHA versus branch ref

These candidates are retained so the evaluator can produce explicit deterministic rejections. Hard separations may bypass JSON-type compatibility because REST numeric IDs and GraphQL node IDs can use different primitive types.

### Narrow ambiguous candidates

Unclassified outputs are considered only through reviewed patterns:

- Contact email to Gmail recipient requires contact/address selection.
- Repository `full_name` requires splitting or transformation.
- Combined issue-or-pull-request search results require resource disambiguation.
- Unsafe nested generic IDs are retained only in narrow resource-local contexts for deterministic rejection.

Ontology aliases are applied during normalization and are not broadly re-expanded during candidate generation.

## Evaluation priority

Evaluation uses the following priority order:

1. Unsafe generic identity field → `REJECTED`
2. Ontology hard separation → `REJECTED`
3. Contact identity resolution → `UNCERTAIN`
4. Repository full-name transformation → `UNCERTAIN`
5. Combined issue/pull-request number → `UNCERTAIN`
6. JSON type mismatch → `REJECTED`
7. Service mismatch → `REJECTED`
8. Canonical entity mismatch → `REJECTED`
9. Producer requires the same identity it returns → `REJECTED`
10. Collection output requires item selection → `UNCERTAIN`
11. Deprecated producer → `UNCERTAIN`
12. Incomplete producer schema → `UNCERTAIN`
13. Non-high-confidence canonical identity → `UNCERTAIN`
14. Safe scalar exact entity match that adds information → `ACCEPTED`

## Producer usefulness

A producer does not help obtain an identity when the action already requires that identity, including conditionally required identity alternatives recorded in normalized scope metadata.

For example, a workflow lookup that requires `workflow_id` or `workflow_name` and returns the same workflow ID is rejected as `PRODUCER_ADDS_NO_NEW_INFORMATION`.

## Collections and disambiguation

An array-derived output is not accepted automatically. Even when its canonical entity matches the consumer, the agent must select a specific item. These candidates are marked `UNCERTAIN` with:

- `selectionRequired: true`
- `disambiguationRequired: true`

A hard identity contradiction remains rejected, but the selection flag is retained when the producer is a collection.

## Scope diagnostics

The evaluator compares required canonical context on producer and consumer tools and records one of:

- `SHARED_REQUIRED_CONTEXT`
- `NO_REQUIRED_CONTEXT`
- `CONTEXT_NOT_SHARED`

These are diagnostics only. The evaluator does not guess runtime values or invent equality between owner, repository, organization, calendar, or other scope fields.

## Decision artifacts

`src/matching/write-artifacts.ts` writes:

- `data/candidates.accepted.json`
- `data/candidates.uncertain.json`
- `data/candidates.rejected.json`
- `validation-report.initial.json`

The output contains exact endpoint paths, canonical identities, generation reasons, stable evaluation reasons, workflow flags, and scope diagnostics. Records are sorted by candidate ID, contain no timestamps, and are deterministic for identical inputs.

## Gold evaluation metrics

The validation report calculates:

- Positive recall
- Negative rejection rate
- False positives
- False negatives
- Ambiguous cases incorrectly accepted
- Missing gold cases
- Decision, reason, and workflow-flag agreement
- Generic-field rejections
- Same-information rejections
- Service, type, entity, and protocol-identity rejections
- Selection, disambiguation, and transformation counts

The initial deterministic checkpoint requires:

- 20 of 20 positive cases accepted
- 20 of 20 negative cases rejected
- 0 ambiguous cases accepted
- 0 missing gold cases
- Exact agreement on all 50 primary reasons and workflow flags

## Limitations

The deterministic matcher does not prove that two runtime scope values are equal. It does not automatically choose an item from a collection, split repository `full_name`, choose among multiple contact email addresses, or decide whether a combined GitHub search result is an issue or pull request. These cases remain uncertain for explicit downstream resolution.
