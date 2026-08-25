import type {
  AdjudicationDecision,
} from "./schema";
import {
  AdjudicationDecisionSchema,
} from "./schema";
import type {
  AdjudicationRequest,
} from "./request-builder";

export const ADJUDICATION_VALIDATION_CODES = [
  "INVALID_JSON",
  "NON_JSON_CONTENT",
  "SCHEMA_VALIDATION_FAILED",
  "CANDIDATE_ID_MISMATCH",
  "UNKNOWN_TOOL_REFERENCE",
  "UNKNOWN_PATH_REFERENCE",
  "UNKNOWN_ENTITY_REFERENCE",
  "UNKNOWN_SCOPE_REFERENCE",
  "UNKNOWN_EVIDENCE_REFERENCE",
  "EXTERNAL_KNOWLEDGE_USED",
  "DETERMINISTIC_HARD_RULE_CONFLICT",
  "UNSUPPORTED_TRANSFORMATION",
  "MISSING_EVIDENCE",
  "COLLECTION_SELECTION_IGNORED",
  "DISAMBIGUATION_IGNORED",
] as const;

export type AdjudicationValidationCode =
  typeof ADJUDICATION_VALIDATION_CODES[
    number
  ];

export type AdjudicationValidationIssue = {
  code: AdjudicationValidationCode;
  message: string;
};

export type AdjudicationValidationResult =
  | {
      valid: true;
      decision: AdjudicationDecision;
      issues: [];
    }
  | {
      valid: false;
      decision?: AdjudicationDecision;
      issues:
        AdjudicationValidationIssue[];
    };

const HARD_CONFLICT_REASONS =
  new Set<string>([
    "ENTITY_MISMATCH",
    "SERVICE_MISMATCH",
    "TYPE_MISMATCH",
    "PROTOCOL_IDENTITY_MISMATCH",
    "PRODUCER_ADDS_NO_NEW_INFORMATION",
    "GENERIC_FIELD_WITHOUT_RESOURCE_EVIDENCE",
  ]);

function entityPairKey(
  left: string,
  right: string,
): string {
  return [left, right]
    .sort()
    .join("::");
}

const HARD_SEPARATED_ENTITY_PAIRS =
  new Set(
    [
      [
        "gmail.message_id",
        "gmail.thread_id",
      ],
      [
        "calendar.calendar_id",
        "calendar.event_id",
      ],
      [
        "calendar.calendar_id",
        "calendar.watch_channel_id",
      ],
      [
        "calendar.event_id",
        "calendar.watch_channel_id",
      ],
      [
        "drive.file_id",
        "drive.revision_id",
      ],
      [
        "drive.file_id",
        "drive.watch_channel_id",
      ],
      [
        "github.workflow_id",
        "github.workflow_run_id",
      ],
      [
        "github.workflow_run_id",
        "github.workflow_run_number",
      ],
      [
        "github.job_id",
        "github.workflow_run_id",
      ],
      [
        "github.release_id",
        "github.release_asset_id",
      ],
      [
        "github.repository_id",
        "github.repository_node_id",
      ],
      [
        "github.issue_number",
        "github.pull_request_number",
      ],
      [
        "github.file_id",
        "github.comment_id",
      ],
    ].map(
      ([left, right]) =>
        entityPairKey(
          left!,
          right!,
        ),
    ),
  );

function addIssue(
  issues:
    AdjudicationValidationIssue[],
  code:
    AdjudicationValidationCode,
  message: string,
): void {
  const alreadyPresent =
    issues.some(
      (issue) =>
        issue.code === code &&
        issue.message === message,
    );

  if (!alreadyPresent) {
    issues.push({
      code,
      message,
    });
  }
}

function failedResult(
  issues:
    AdjudicationValidationIssue[],
  decision?: AdjudicationDecision,
): AdjudicationValidationResult {
  if (decision) {
    return {
      valid: false,
      decision,
      issues,
    };
  }

  return {
    valid: false,
    issues,
  };
}

function containsWrappedJsonObject(
  value: string,
): boolean {
  const firstBrace =
    value.indexOf("{");

  const lastBrace =
    value.lastIndexOf("}");

  if (
    firstBrace < 0 ||
    lastBrace <= firstBrace
  ) {
    return false;
  }

  try {
    const parsed = JSON.parse(
      value.slice(
        firstBrace,
        lastBrace + 1,
      ),
    );

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

function hasDeterministicHardConflict(
  request: AdjudicationRequest,
): boolean {
  const {
    checks,
    primaryReason,
  } = request.deterministicAnalysis;

  if (
    HARD_CONFLICT_REASONS.has(
      primaryReason,
    )
  ) {
    return true;
  }

  if (
    checks.entityCompatible ===
      false ||
    checks.typeCompatible === false ||
    checks.serviceCompatible ===
      false ||
    checks
      .protocolIdentityCompatible ===
      false ||
    checks.producerAddsNewInformation ===
      false
  ) {
    return true;
  }

  const producerEntity =
    request.producer.field
      .canonicalEntity?.entity;

  const consumerEntity =
    request.consumer.field
      .canonicalEntity?.entity;

  if (
    producerEntity &&
    consumerEntity &&
    HARD_SEPARATED_ENTITY_PAIRS.has(
      entityPairKey(
        producerEntity,
        consumerEntity,
      ),
    )
  ) {
    return true;
  }

  return false;
}

function transformationIsSupported(
  request: AdjudicationRequest,
): boolean {
  return (
    request
      .deterministicAnalysis
      .transformationRequired ||
    request
      .deterministicAnalysis
      .generationReasons
      .includes(
        "REPOSITORY_FULL_NAME_TRANSFORMATION",
      )
  );
}

function hasEndpointEvidence(
  references: string[],
  endpoint:
    "producer" | "consumer",
): boolean {
  const acceptedReferences =
    new Set([
      `${endpoint}.tool.description`,
      `${endpoint}.field.path`,
      `${endpoint}.field.sourceSchemaPath`,
      `${endpoint}.field.description`,
      `${endpoint}.field.canonicalEntity`,
    ]);

  return references.some(
    (reference) =>
      acceptedReferences.has(
        reference,
      ),
  );
}

function classifyUnknownReference(
  reference: string,
  issues:
    AdjudicationValidationIssue[],
): void {
  if (
    /^(GITHUB|GOOGLESUPER)_[A-Z0-9_]+/.test(
      reference,
    )
  ) {
    addIssue(
      issues,
      "UNKNOWN_TOOL_REFERENCE",
      `Unknown tool reference: ${reference}`,
    );
  }

  if (
    reference.includes("$") ||
    reference.includes(":input:") ||
    reference.includes(":output:")
  ) {
    addIssue(
      issues,
      "UNKNOWN_PATH_REFERENCE",
      `Unknown field-path reference: ${reference}`,
    );
  }

  if (
    /^scope[:.]/i.test(reference)
  ) {
    addIssue(
      issues,
      "UNKNOWN_SCOPE_REFERENCE",
      `Unknown scope reference: ${reference}`,
    );
  }

  if (
    /^(github|gmail|calendar|drive|people)\.[a-z0-9_]+$/i.test(
      reference,
    )
  ) {
    addIssue(
      issues,
      "UNKNOWN_ENTITY_REFERENCE",
      `Unknown canonical-entity reference: ${reference}`,
    );
  }
}

function validateNarrativeReferences(
  decision: AdjudicationDecision,
  request: AdjudicationRequest,
  issues:
    AdjudicationValidationIssue[],
): void {
  const explanation =
    decision.explanation;

  const allowedTools =
    new Set([
      request.producer.tool.slug,
      request.consumer.tool.slug,
    ]);

  const toolReferences =
    explanation.match(
      /\b(?:GITHUB|GOOGLESUPER)_[A-Z0-9_]+\b/g,
    ) ?? [];

  for (
    const toolReference
    of toolReferences
  ) {
    if (
      !allowedTools.has(
        toolReference,
      )
    ) {
      addIssue(
        issues,
        "UNKNOWN_TOOL_REFERENCE",
        `Explanation references an unknown tool: ${toolReference}`,
      );
    }
  }

  const allowedPaths =
    new Set<string>([
      request.producer.field.path,
      request.producer.field
        .sourceSchemaPath,
      request.consumer.field.path,
      request.consumer.field
        .sourceSchemaPath,
      ...request.producer.field.scopes
        .map(
          (scope) =>
            scope.valueSourcePath,
        )
        .filter(
          (
            path,
          ): path is string =>
            typeof path === "string",
        ),
      ...request.consumer.field.scopes
        .map(
          (scope) =>
            scope.valueSourcePath,
        )
        .filter(
          (
            path,
          ): path is string =>
            typeof path === "string",
        ),
    ]);

  const pathPattern =
    /`(\$[^`]+)`/g;

  for (
    const match
    of explanation.matchAll(
      pathPattern,
    )
  ) {
    const path = match[1];

    if (
      path &&
      !allowedPaths.has(path)
    ) {
      addIssue(
        issues,
        "UNKNOWN_PATH_REFERENCE",
        `Explanation references an unknown path: ${path}`,
      );
    }
  }

  const allowedEntities =
    new Set(
      [
        request
          .deterministicAnalysis
          .matchedCanonicalEntity,
        request.producer.field
          .canonicalEntity?.entity,
        request.consumer.field
          .canonicalEntity?.entity,
        ...request
          .deterministicAnalysis
          .checks
          .producerScopeEntities,
        ...request
          .deterministicAnalysis
          .checks
          .consumerScopeEntities,
        ...request
          .deterministicAnalysis
          .checks
          .sharedScopeEntities,
      ].filter(
        (
          entity,
        ): entity is string =>
          typeof entity === "string",
      ),
    );

  const entityPattern =
    /`((?:github|gmail|calendar|drive|people)\.[a-z0-9_]+)`/gi;

  for (
    const match
    of explanation.matchAll(
      entityPattern,
    )
  ) {
    const entity = match[1];

    if (
      entity &&
      !allowedEntities.has(entity)
    ) {
      addIssue(
        issues,
        "UNKNOWN_ENTITY_REFERENCE",
        `Explanation references an unknown entity: ${entity}`,
      );
    }
  }

  const allowedScopeKinds =
    new Set<string>([
      ...request.producer.field.scopes
        .map(
          (scope) => scope.kind,
        ),
      ...request.consumer.field.scopes
        .map(
          (scope) => scope.kind,
        ),
    ]);

  const scopePattern =
    /`scope:([a-z0-9_.-]+)`/gi;

  for (
    const match
    of explanation.matchAll(
      scopePattern,
    )
  ) {
    const scope = match[1];

    if (
      scope &&
      !allowedScopeKinds.has(scope)
    ) {
      addIssue(
        issues,
        "UNKNOWN_SCOPE_REFERENCE",
        `Explanation references an unknown scope: ${scope}`,
      );
    }
  }
}

function usesExplicitExternalKnowledge(
  explanation: string,
): boolean {
  return (
    /\baccording to (?:the )?(?:external|official|github|google) (?:api )?documentation\b/i.test(
      explanation,
    ) ||
    /\bfrom memory\b/i.test(
      explanation,
    ) ||
    /\boutside (?:api )?knowledge\b/i.test(
      explanation,
    ) ||
    /\bi know that\b/i.test(
      explanation,
    )
  );
}

export function validateAdjudicationResponse(
  rawResponse: string,
  request: AdjudicationRequest,
): AdjudicationValidationResult {
  const trimmed =
    rawResponse.trim();

  if (
    !trimmed.startsWith("{") ||
    !trimmed.endsWith("}")
  ) {
    return failedResult([
      {
        code:
          "NON_JSON_CONTENT",
        message:
          "The response was not exactly one JSON object.",
      },
    ]);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const code =
      containsWrappedJsonObject(
        trimmed,
      )
        ? "NON_JSON_CONTENT"
        : "INVALID_JSON";

    return failedResult([
      {
        code,
        message:
          code ===
          "NON_JSON_CONTENT"
            ? "The response contained content outside the JSON object."
            : "The response was not valid JSON.",
      },
    ]);
  }

  const schemaResult =
    AdjudicationDecisionSchema
      .safeParse(parsed);

  if (!schemaResult.success) {
    return failedResult([
      {
        code:
          "SCHEMA_VALIDATION_FAILED",
        message:
          schemaResult.error.message,
      },
    ]);
  }

  const decision =
    schemaResult.data;

  const issues:
    AdjudicationValidationIssue[] =
    [];

  if (
    decision.candidateId !==
    request.candidateId
  ) {
    addIssue(
      issues,
      "CANDIDATE_ID_MISMATCH",
      `Expected candidate ${request.candidateId}, received ${decision.candidateId}.`,
    );
  }

  const allowedReferences =
    new Set(
      request
        .allowedEvidenceReferences,
    );

  for (
    const reference
    of decision.evidenceReferences
  ) {
    if (
      !allowedReferences.has(
        reference,
      )
    ) {
      addIssue(
        issues,
        "UNKNOWN_EVIDENCE_REFERENCE",
        `Evidence reference is not allowlisted: ${reference}`,
      );

      classifyUnknownReference(
        reference,
        issues,
      );
    }
  }

  validateNarrativeReferences(
    decision,
    request,
    issues,
  );

  if (
    usesExplicitExternalKnowledge(
      decision.explanation,
    )
  ) {
    addIssue(
      issues,
      "EXTERNAL_KNOWLEDGE_USED",
      "The explanation explicitly relies on knowledge outside the supplied evidence.",
    );
  }

  if (
    request
      .deterministicAnalysis
      .selectionRequired &&
    !decision.requiresSelection
  ) {
    addIssue(
      issues,
      "COLLECTION_SELECTION_IGNORED",
      "The deterministic candidate requires collection selection, but the response cleared that requirement.",
    );
  }

  if (
    request
      .deterministicAnalysis
      .disambiguationRequired &&
    !decision
      .requiresDisambiguation
  ) {
    addIssue(
      issues,
      "DISAMBIGUATION_IGNORED",
      "The deterministic candidate requires disambiguation, but the response cleared that requirement.",
    );
  }

  const transformationSupported =
    transformationIsSupported(
      request,
    );

  if (
    (
      decision
        .requiresTransformation ||
      decision.dependencyKind ===
        "TRANSFORMATION"
    ) &&
    !transformationSupported
  ) {
    addIssue(
      issues,
      "UNSUPPORTED_TRANSFORMATION",
      "The response claims a transformation that is not supported by the supplied deterministic evidence.",
    );
  }

  if (
    request
      .deterministicAnalysis
      .transformationRequired &&
    !decision
      .requiresTransformation
  ) {
    addIssue(
      issues,
      "UNSUPPORTED_TRANSFORMATION",
      "The response cleared a required transformation.",
    );
  }

  if (
    decision
      .requiresTransformation !==
    (
      decision.dependencyKind ===
      "TRANSFORMATION"
    )
  ) {
    addIssue(
      issues,
      "UNSUPPORTED_TRANSFORMATION",
      "The transformation flag and dependency kind are inconsistent.",
    );
  }

  if (
    decision.decision ===
      "ACCEPT" &&
    hasDeterministicHardConflict(
      request,
    )
  ) {
    addIssue(
      issues,
      "DETERMINISTIC_HARD_RULE_CONFLICT",
      "The response accepts a dependency that conflicts with a deterministic hard rule.",
    );
  }

  if (
    decision.decision ===
      "ACCEPT" &&
    (
      !hasEndpointEvidence(
        decision
          .evidenceReferences,
        "producer",
      ) ||
      !hasEndpointEvidence(
        decision
          .evidenceReferences,
        "consumer",
      )
    )
  ) {
    addIssue(
      issues,
      "MISSING_EVIDENCE",
      "An ACCEPT decision must cite semantic evidence for both the producer and consumer endpoints.",
    );
  }

  if (issues.length > 0) {
    return failedResult(
      issues,
      decision,
    );
  }

  return {
    valid: true,
    decision,
    issues: [],
  };
}