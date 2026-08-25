import type {
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
} from "../types";
import {
  jsonTypesCompatible,
} from "./candidate-generator";
import type {
  DependencyCandidate,
} from "./types";

export type CandidateDecision =
  | "ACCEPTED"
  | "UNCERTAIN"
  | "REJECTED";

export type EvaluationReason =
  | "EXACT_CANONICAL_ENTITY_MATCH"
  | "ENTITY_MISMATCH"
  | "SERVICE_MISMATCH"
  | "TYPE_MISMATCH"
  | "PROTOCOL_IDENTITY_MISMATCH"
  | "PRODUCER_ADDS_NO_NEW_INFORMATION"
  | "GENERIC_FIELD_WITHOUT_RESOURCE_EVIDENCE"
  | "COLLECTION_REQUIRES_SELECTION"
  | "IDENTITY_RESOLUTION_REQUIRES_DISAMBIGUATION"
  | "TRANSFORMATION_REQUIRED"
  | "AMBIGUOUS_ISSUE_PULL_REQUEST_NUMBER"
  | "DEPRECATED_PRODUCER"
  | "INCOMPLETE_PRODUCER_SCHEMA"
  | "LOW_CONFIDENCE_CANONICAL_ENTITY";

export type ScopeStatus =
  | "SHARED_REQUIRED_CONTEXT"
  | "NO_REQUIRED_CONTEXT"
  | "CONTEXT_NOT_SHARED";

export type EvaluationChecks = {
  entityCompatible: boolean;
  typeCompatible: boolean;
  serviceCompatible: boolean;
  protocolIdentityCompatible: boolean;
  producerSafeForInference: boolean;
  consumerHasCanonicalEntity: boolean;
  producerAddsNewInformation: boolean;
  scopeStatus: ScopeStatus;
  producerScopeEntities: string[];
  consumerScopeEntities: string[];
  sharedScopeEntities: string[];
};

export type CandidateEvaluation = {
  decision: CandidateDecision;
  primaryReason: EvaluationReason;
  reasonCodes: string[];
  selectionRequired: boolean;
  transformationRequired: boolean;
  disambiguationRequired: boolean;
  checks: EvaluationChecks;
};

export type EvaluatedDependencyCandidate = {
  candidate: DependencyCandidate;
  evaluation: CandidateEvaluation;
};

export type EvaluationContext = {
  toolsBySlug: Map<string, NormalizedTool>;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function entityOf(
  field: NormalizedSchemaField,
): string | null {
  return field.canonicalEntity?.entity ?? null;
}

function candidateEntityPair(
  candidate: DependencyCandidate,
): [string | null, string | null] {
  return [
    candidate.producer.canonicalEntity,
    candidate.consumer.canonicalEntity,
  ];
}

function hasReason(
  candidate: DependencyCandidate,
  reason: string,
): boolean {
  return candidate.generationReasons.includes(
    reason as never,
  );
}

function isProtocolIdentityMismatch(
  producerEntity: string | null,
  consumerEntity: string | null,
): boolean {
  if (!producerEntity || !consumerEntity) {
    return false;
  }

  const pair = [producerEntity, consumerEntity];

  return (
    pair.some((entity) =>
      entity.endsWith("_node_id"),
    ) &&
    pair.some((entity) =>
      !entity.endsWith("_node_id") &&
      entity.endsWith("_id"),
    )
  );
}

function requiredScopeEntities(
  tool: NormalizedTool | undefined,
  targetEntity: string | null,
): string[] {
  if (!tool) {
    return [];
  }

  return unique(
    tool.inputFields
      .filter(
        (field) =>
          field.effectivelyRequired &&
          field.canonicalEntity !== undefined &&
          field.canonicalEntity.entity !==
            targetEntity,
      )
      .map(
        (field) =>
          field.canonicalEntity!.entity,
      ),
  ).sort();
}

function scopeCheck(
  candidate: DependencyCandidate,
  context: EvaluationContext,
): Pick<
  EvaluationChecks,
  | "scopeStatus"
  | "producerScopeEntities"
  | "consumerScopeEntities"
  | "sharedScopeEntities"
> {
  const targetEntity =
    candidate.matchedCanonicalEntity ??
    candidate.consumer.canonicalEntity ??
    candidate.producer.canonicalEntity;

  const producerTool =
    context.toolsBySlug.get(
      candidate.producer.toolSlug,
    );

  const consumerTool =
    context.toolsBySlug.get(
      candidate.consumer.toolSlug,
    );

  const producerScopeEntities =
    requiredScopeEntities(
      producerTool,
      targetEntity,
    );

  const consumerScopeEntities =
    requiredScopeEntities(
      consumerTool,
      targetEntity,
    );

  const consumerSet = new Set(
    consumerScopeEntities,
  );

  const sharedScopeEntities =
    producerScopeEntities.filter((entity) =>
      consumerSet.has(entity),
    );

  let scopeStatus: ScopeStatus =
    "NO_REQUIRED_CONTEXT";

  if (
    producerScopeEntities.length > 0 &&
    consumerScopeEntities.length > 0
  ) {
    scopeStatus =
      sharedScopeEntities.length > 0
        ? "SHARED_REQUIRED_CONTEXT"
        : "CONTEXT_NOT_SHARED";
  }

  return {
    scopeStatus,
    producerScopeEntities,
    consumerScopeEntities,
    sharedScopeEntities,
  };
}

function producerAddsNoNewInformation(
  candidate: DependencyCandidate,
  context: EvaluationContext,
): boolean {
  const entity =
    candidate.producer.canonicalEntity ??
    candidate.matchedCanonicalEntity;

  if (!entity) {
    return false;
  }

  const producerTool =
    context.toolsBySlug.get(
      candidate.producer.toolSlug,
    );

  if (!producerTool) {
    return false;
  }

  return producerTool.inputFields.some(
    (field) => {
      if (entityOf(field) !== entity) {
        return false;
      }

      /*
       * Some APIs express an identity as alternatives,
       * such as workflow_id or workflow_name. The ID
       * field is not individually required, but its
       * scope still marks it as required for resolving
       * the returned resource identity.
       */
      const requiredIdentityScope =
        field.scopes.some(
          (scope) =>
            scope.requiredForIdentity &&
            scope.valueSourcePath ===
              field.jsonPath,
        );

      return (
        field.effectivelyRequired ||
        requiredIdentityScope
      );
    },
  );
}

function endpointTypesCompatible(
  candidate: DependencyCandidate,
  context: EvaluationContext,
): boolean {
  const producerTool =
    context.toolsBySlug.get(
      candidate.producer.toolSlug,
    );

  const consumerTool =
    context.toolsBySlug.get(
      candidate.consumer.toolSlug,
    );

  const producerField =
    producerTool?.outputFields.find(
      (field) =>
        field.fieldId ===
        candidate.producer.fieldId,
    );

  const consumerField =
    consumerTool?.inputFields.find(
      (field) =>
        field.fieldId ===
        candidate.consumer.fieldId,
    );

  if (!producerField || !consumerField) {
    return false;
  }

  return jsonTypesCompatible(
    producerField,
    consumerField,
  );
}

function buildChecks(
  candidate: DependencyCandidate,
  context: EvaluationContext,
): EvaluationChecks {
  const [producerEntity, consumerEntity] =
    candidateEntityPair(candidate);

  const typeCompatible =
    endpointTypesCompatible(
      candidate,
      context,
    );

  const serviceCompatible =
    candidate.producer.service ===
    candidate.consumer.service;

  const protocolIdentityCompatible =
    !isProtocolIdentityMismatch(
      producerEntity,
      consumerEntity,
    );

  const producerAddsNewInformation =
    !producerAddsNoNewInformation(
      candidate,
      context,
    );

  return {
    entityCompatible:
      producerEntity !== null &&
      producerEntity === consumerEntity,
    typeCompatible,
    serviceCompatible,
    protocolIdentityCompatible,
    producerSafeForInference:
      candidate.producer.safeForInference,
    consumerHasCanonicalEntity:
      consumerEntity !== null,
    producerAddsNewInformation,
    ...scopeCheck(candidate, context),
  };
}

function result(
  decision: CandidateDecision,
  primaryReason: EvaluationReason,
  checks: EvaluationChecks,
  flags: {
    selectionRequired?: boolean;
    transformationRequired?: boolean;
    disambiguationRequired?: boolean;
  } = {},
): CandidateEvaluation {
  const reasonCodes = unique([
    primaryReason,
    checks.entityCompatible
      ? "ENTITY_COMPATIBLE"
      : "ENTITY_NOT_COMPATIBLE",
    checks.typeCompatible
      ? "TYPE_COMPATIBLE"
      : "TYPE_NOT_COMPATIBLE",
    checks.serviceCompatible
      ? "SERVICE_COMPATIBLE"
      : "SERVICE_NOT_COMPATIBLE",
    checks.protocolIdentityCompatible
      ? "PROTOCOL_IDENTITY_COMPATIBLE"
      : "PROTOCOL_IDENTITY_NOT_COMPATIBLE",
    checks.producerSafeForInference
      ? "PRODUCER_SAFE_FOR_INFERENCE"
      : "PRODUCER_NOT_SAFE_FOR_INFERENCE",
    checks.producerAddsNewInformation
      ? "PRODUCER_ADDS_NEW_INFORMATION"
      : "PRODUCER_ADDS_NO_NEW_INFORMATION",
    `SCOPE_${checks.scopeStatus}`,
  ]);

  return {
    decision,
    primaryReason,
    reasonCodes,
    selectionRequired:
      flags.selectionRequired ?? false,
    transformationRequired:
      flags.transformationRequired ?? false,
    disambiguationRequired:
      flags.disambiguationRequired ?? false,
    checks,
  };
}

export function createEvaluationContext(
  catalog: NormalizedToolCatalog,
): EvaluationContext {
  return {
    toolsBySlug: new Map(
      catalog.tools.map((tool) => [
        tool.metadata.slug,
        tool,
      ]),
    ),
  };
}

export function evaluateDependencyCandidate(
  candidate: DependencyCandidate,
  context: EvaluationContext,
): CandidateEvaluation {
  const checks = buildChecks(
    candidate,
    context,
  );

  /*
   * Unsafe generic identity fields are deterministic
   * rejections, even if a nearby outer resource happens
   * to have the same broad family.
   */
  if (
    hasReason(
      candidate,
      "GENERIC_IDENTITY_FIELD",
    )
  ) {
    return result(
      "REJECTED",
      "GENERIC_FIELD_WITHOUT_RESOURCE_EVIDENCE",
      checks,
    );
  }

  /*
   * Ontology hard separations are stronger than type
   * compatibility or collection status.
   */
  if (
    hasReason(
      candidate,
      "HARD_SEPARATION_PAIR",
    ) ||
    candidate.hardSeparation !== null
  ) {
    /*
     * A collection-derived value may still require the
     * user to choose an item even when the selected
     * value would ultimately be rejected as the wrong
     * canonical entity.
     */
    const flags = {
      selectionRequired:
        candidate.producer.arrayDepth > 0,
    };

    if (
      !checks.protocolIdentityCompatible
    ) {
      return result(
        "REJECTED",
        "PROTOCOL_IDENTITY_MISMATCH",
        checks,
        flags,
      );
    }

    if (!checks.serviceCompatible) {
      return result(
        "REJECTED",
        "SERVICE_MISMATCH",
        checks,
        flags,
      );
    }

    return result(
      "REJECTED",
      "ENTITY_MISMATCH",
      checks,
      flags,
    );
  }

  /*
   * Contact results can contain multiple contacts and
   * multiple email addresses. They require explicit
   * user selection before filling a recipient field.
   */
  if (
    hasReason(
      candidate,
      "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
    )
  ) {
    return result(
      "UNCERTAIN",
      "IDENTITY_RESOLUTION_REQUIRES_DISAMBIGUATION",
      checks,
      {
        selectionRequired: true,
        disambiguationRequired: true,
      },
    );
  }

  if (
    hasReason(
      candidate,
      "REPOSITORY_FULL_NAME_TRANSFORMATION",
    )
  ) {
    return result(
      "UNCERTAIN",
      "TRANSFORMATION_REQUIRED",
      checks,
      {
        transformationRequired: true,
        disambiguationRequired: true,
      },
    );
  }

  if (
    hasReason(
      candidate,
      "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
    )
  ) {
    return result(
      "UNCERTAIN",
      "AMBIGUOUS_ISSUE_PULL_REQUEST_NUMBER",
      checks,
      {
        selectionRequired: true,
        disambiguationRequired: true,
      },
    );
  }

  if (!checks.typeCompatible) {
    return result(
      "REJECTED",
      "TYPE_MISMATCH",
      checks,
    );
  }

  if (!checks.serviceCompatible) {
    return result(
      "REJECTED",
      "SERVICE_MISMATCH",
      checks,
    );
  }

  if (
    !candidate.matchedCanonicalEntity ||
    !checks.entityCompatible
  ) {
    return result(
      "REJECTED",
      "ENTITY_MISMATCH",
      checks,
    );
  }

  /*
   * A lookup that requires the same identifier it later
   * returns does not help an agent obtain that missing
   * identifier.
   */
  if (!checks.producerAddsNewInformation) {
    return result(
      "REJECTED",
      "PRODUCER_ADDS_NO_NEW_INFORMATION",
      checks,
    );
  }

  if (candidate.producer.arrayDepth > 0) {
    return result(
      "UNCERTAIN",
      "COLLECTION_REQUIRES_SELECTION",
      checks,
      {
        selectionRequired: true,
        disambiguationRequired: true,
      },
    );
  }

  if (candidate.producer.deprecated) {
    return result(
      "UNCERTAIN",
      "DEPRECATED_PRODUCER",
      checks,
      {
        disambiguationRequired: true,
      },
    );
  }

  if (
    candidate.producer.schemaCompleteness !==
    "COMPLETE"
  ) {
    return result(
      "UNCERTAIN",
      "INCOMPLETE_PRODUCER_SCHEMA",
      checks,
      {
        disambiguationRequired: true,
      },
    );
  }

  if (
    candidate.producer.canonicalConfidence !==
      "HIGH" ||
    candidate.consumer.canonicalConfidence !==
      "HIGH"
  ) {
    return result(
      "UNCERTAIN",
      "LOW_CONFIDENCE_CANONICAL_ENTITY",
      checks,
      {
        disambiguationRequired: true,
      },
    );
  }

  if (!checks.producerSafeForInference) {
    return result(
      "REJECTED",
      "GENERIC_FIELD_WITHOUT_RESOURCE_EVIDENCE",
      checks,
    );
  }

  return result(
    "ACCEPTED",
    "EXACT_CANONICAL_ENTITY_MATCH",
    checks,
  );
}

export function evaluateDependencyCandidates(
  candidates: DependencyCandidate[],
  catalog: NormalizedToolCatalog,
): EvaluatedDependencyCandidate[] {
  const context =
    createEvaluationContext(catalog);

  return candidates.map((candidate) => ({
    candidate,
    evaluation:
      evaluateDependencyCandidate(
        candidate,
        context,
      ),
  }));
}
