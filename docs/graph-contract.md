# Graph and Normalization Contract

## Status

This document defines the contracts for normalization and future relationship analysis.

It does not create dependency candidates or dependency edges.

## Observed raw-schema structure

The authenticated Composio snapshots use the following raw tool schema locations:

* `input_parameters`
* `output_parameters`

The normalizer must also tolerate the camelCase SDK forms:

* `inputParameters`
* `outputParameters`

The inspected schemas demonstrate:

* root JSON Schema objects
* nested `properties`
* nested arrays through `items`
* local `$ref` references
* root `$defs`
* collection responses
* response envelopes containing `data`, `error`, and `successful`
* `anyOf` alternatives, including a GitHub repository-content response that may contain one object or an array
* deprecated tools alongside current tools
* REST identifiers and GraphQL node identifiers in the same resource objects
* schemas whose nested result objects are not defined precisely enough for safe entity inference

## Normalized catalog

The generated normalized catalog must use:

```text
data/normalized-tools.json
```

Its top-level format is:

```ts
type NormalizedToolCatalog = {
  format: "normalized-tool-catalog-v1";
  generatedAt: string;
  sourceFiles: SourceFileSummary[];
  tools: NormalizedTool[];
  summary: NormalizedCatalogSummary;
};
```

Every raw tool must produce exactly one normalized tool record unless normalization fails explicitly.

The normalizer must never silently discard a tool.

## Tool identity

A normalized tool is identified by its exact Composio slug.

Examples include:

```text
GOOGLESUPER_LIST_THREADS
GOOGLESUPER_EVENTS_LIST
GITHUB_LIST_REPOSITORY_WORKFLOWS
GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY
```

Tool names and descriptions are supporting metadata. They are not stable identifiers.

## Toolkit versions

Each normalized tool preserves:

* the exact tool version returned by the raw schema
* available versions returned for that tool
* the raw snapshot containing the tool

The verified raw snapshots currently contain:

```text
googlesuper: 20260714_00
github:      20260713_00
```

The normalizer must read these values from the raw files rather than hard-code them.

## Tool classification

Each normalized tool records:

* toolkit
* underlying service
* resource family
* action family
* protocol
* abstraction level
* lifecycle
* input schema completeness
* output schema completeness

### Underlying Google services

`googlesuper` must not be treated as one resource namespace.

Possible underlying services include:

```text
gmail
people
contacts
calendar
drive
docs
sheets
slides
tasks
meet
analytics
unknown
```

A Gmail identifier must not match a Drive or Calendar identifier merely because both are strings.

### GitHub resource families

Possible resource families include:

```text
repository
issue
pull_request
workflow
workflow_run
job
branch
commit
repository_content
release
release_asset
organization
team
environment
user
project
unknown
```

A resource family should be assigned only when the slug, description, tags, or schema provides sufficient evidence.

## Protocol

The supported protocol classifications are:

```text
REST
GRAPHQL
COMPOSIO_CONVENIENCE_HELPER
UNKNOWN
```

A REST object can expose a GraphQL `node_id`. This does not make the entire tool GraphQL.

The protocol describes the operation. Identifier classification separately distinguishes REST IDs from GraphQL node IDs.

## Abstraction level

The supported abstraction levels are:

```text
PRIMITIVE
RESOURCE_OPERATION
CONVENIENCE_WORKFLOW
UNKNOWN
```

Examples:

* a low-level blob or Git-object operation may be `PRIMITIVE`
* a normal list, get, create, update, or delete operation may be `RESOURCE_OPERATION`
* an AI-optimized search or multi-step helper may be `CONVENIENCE_WORKFLOW`

Classification must remain `UNKNOWN` when evidence is insufficient.

## Lifecycle

The supported lifecycle values are:

```text
CURRENT
LEGACY
BETA
DEPRECATED
UNKNOWN
```

The normalizer must preserve both explicit metadata and textual evidence.

For example, a tool whose raw metadata says it is deprecated remains deprecated even if its schema is complete.

Schema completeness and lifecycle are independent concepts.

## Field paths

Every normalized field preserves two paths.

### Runtime JSON path

`jsonPath` represents the location in an actual input or output value.

Examples:

```text
$.thread_id
$.data.threads[].id
$.data.items[].id
$.data.workflow_runs[].run_number
```

Reference traversal markers must not appear in this path.

### Source schema path

`sourceSchemaPath` identifies the exact location traversed in the original schema.

It preserves evidence involving:

* `properties`
* `items`
* `$defs`
* `definitions`
* `allOf`
* `anyOf`
* `oneOf`

The normalizer must also preserve the ordered local-reference chain in `refTrace`.

This allows a later phase to prove where a runtime field came from without putting `$ref` markers into the runtime JSON path.

## Required fields

A field records two required statuses.

### `requiredAtParent`

This is true when the field is required by its immediate parent schema.

### `effectivelyRequired`

This is true only when the field and every parent needed to reach it are required.

A child required inside an optional parent is not effectively required for the entire tool invocation.

## Arrays

Each field records:

* whether it is an array
* array depth
* item type or item type union

A value located beneath an array is a collection-derived value.

Later matching must not automatically treat an arbitrary member of a collection as a singular resolved value.

For example:

```text
$.data.threads[].id
$.data.pull_requests[].number
```

may require filtering, selection, or disambiguation.

## Local references

The normalizer must resolve local references such as:

```text
#/$defs/Thread
#/$defs/GoogleCalendarEvent
#/definitions/Example
```

Resolution must be cycle-safe.

The normalizer must:

1. Preserve the original `$ref`.
2. Preserve the reference chain.
3. Mark whether resolution succeeded.
4. Stop recursive cycles.
5. Record unresolved references.
6. Never invent fields for an unresolved reference.

External references must remain unresolved unless explicit support is added later.

## Composition

The following composition keywords must be preserved:

```text
allOf
anyOf
oneOf
```

Each branch records:

* composition kind
* branch index
* exact source schema path
* original branch fragment

Composition branches must not be merged in a way that loses branch identity.

For example, GitHub repository content may be either a singular content item or an array of content items. The normalizer must preserve both alternatives.

## Original schema evidence

Every normalized field stores its original schema fragment in:

```text
rawSchemaFragment
```

This field is evidence and must not be rewritten into a simplified approximation.

## Schema completeness

Supported classifications are:

```text
COMPLETE
PARTIAL
GENERIC
MISSING
```

### COMPLETE

The schema provides named resource fields with usable type and structural evidence.

### PARTIAL

Useful structure exists, but part of the resource shape, typing, reference resolution, or description evidence is incomplete.

### GENERIC

The schema contains only a generic wrapper or an open-ended object without usable resource fields.

### MISSING

No declared schema is present.

A `COMPLETE` classification does not guarantee that every runtime execution populates every field.

## Canonical entities

Canonical entities represent distinct value meanings.

Examples:

```text
gmail.thread_id
gmail.message_id
google.event_id
google.drive_file_id
github.issue_number
github.workflow_run_id
github.workflow_run_number
github.commit_sha
```

Canonical assignment must be conservative.

A generic field name is not enough.

The following names are blocked without resource evidence:

```text
id
ids
number
numbers
name
key
token
ref
reference
sha
value
```

Assignment may use:

* exact field name
* containing resource path
* tool service
* tool resource family
* field description
* `$ref` definition name
* JSON type
* protocol
* ontology aliases

Only high-confidence assignments should later support automatic dependency inference.

## Important identity separations

The normalizer must preserve these distinctions:

* Gmail thread ID versus Gmail message ID
* Drive file ID versus Calendar event ID
* Calendar ID versus Calendar event ID
* GitHub issue number versus pull-request number
* GitHub workflow ID versus workflow-run ID
* workflow-run ID versus workflow-run number
* workflow-run ID versus job ID
* repository REST ID versus repository GraphQL node ID
* release ID versus release-asset ID
* branch ref versus commit SHA
* name versus slug
* number versus ID
* SHA versus arbitrary string

## Scope

Identifiers are not assumed to be globally unique.

Supported scope kinds include:

```text
account
owner
repository
organization
team
environment
workflow
calendar
spreadsheet
shared_drive
global
unknown
```

Examples:

* `github.issue_number` is normally scoped by owner and repository.
* `github.pull_request_number` is normally scoped by owner and repository.
* `github.workflow_run_number` is scoped by repository and workflow.
* `google.event_id` must be interpreted with calendar or account context.
* Drive file identifiers may require account or shared-drive context.

Scopes preserve the field paths that provide their values.

## Possible value sources

A normalized input field may have multiple possible value sources:

```text
USER
PRIOR_CONTEXT
TOOL_OUTPUT
CREATED_RESOURCE
COMPUTED_VALUE
```

The contract does not choose a source during normalization.

It records possible sources and the reason each source is plausible.

## Safe-for-inference status

Every field records:

```text
safeForInference
safetyReasons
```

A field should be unsafe when, for example:

* it is a generic `id` without resource evidence
* its reference cannot be resolved
* it exists only inside an unsupported schema structure
* its schema is generic or missing
* its resource family cannot be determined
* it is an internal Composio bookkeeping field
* REST and GraphQL identity meaning is unclear

Unsafe fields remain in the normalized catalog. They are not deleted.

## Future relationship types

The contracts define these future relationship types:

```text
VALUE
RESOLUTION
STATE
AUTHORIZATION
POLICY
```

No relationship instances or dependency edges are created during normalization.

## Raw-source traceability

Every tool and field must be traceable to:

* raw file
* page index
* item index
* exact tool slug
* schema location
* schema pointer

This traceability is required before a later phase can use a field as evidence.

## Phase boundary

This contract supports schema normalization only.

It does not implement:

* dependency candidate generation
* accepted or rejected dependency edges
* LLM adjudication
* workflow planning
* graph visualization
