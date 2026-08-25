import type {
  CompactCandidateRecord,
  DecisionArtifact,
} from "../matching";
import type {
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
} from "../types";

export type EligibilityCategory =
  | "ELIGIBLE"
  | "INELIGIBLE_HARD_CONFLICT"
  | "INELIGIBLE_INSUFFICIENT_EVIDENCE"
  | "INELIGIBLE_DUPLICATE"
  | "INELIGIBLE_LOW_VALUE";

export type EligibilityAssessment = {
  candidateId: string;
  category: EligibilityCategory;
  reasonCodes: string[];
  explanation: string;
  resolvableQuestions: string[];
  duplicateOf?: string;
  semanticCluster?: string;
};

export type EligibilityContext = {
  toolsBySlug: Map<string, NormalizedTool>;
};

export type ResolvedCandidateEvidence = {
  candidate: CompactCandidateRecord;
  producerTool: NormalizedTool | null;
  consumerTool: NormalizedTool | null;
  producerField: NormalizedSchemaField | null;
  consumerField: NormalizedSchemaField | null;
};

const GENERIC_IDENTITY_NAMES = new Set([
  "id",
  "name",
  "number",
  "key",
  "token",
  "ref",
  "sha",
]);

const SPECIAL_REVIEWABLE_REASONS =
  new Set([
    "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
    "REPOSITORY_FULL_NAME_TRANSFORMATION",
    "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
  ]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function assessment(
  candidate: CompactCandidateRecord,
  category: EligibilityCategory,
  reasonCodes: string[],
  explanation: string,
  resolvableQuestions: string[] = [],
): EligibilityAssessment {
  return {
    candidateId: candidate.id,
    category,
    reasonCodes: unique(reasonCodes),
    explanation,
    resolvableQuestions:
      unique(resolvableQuestions),
  };
}

function fieldByEndpoint(
  fields: NormalizedSchemaField[],
  fieldId: string,
  path: string,
): NormalizedSchemaField | null {
  return (
    fields.find(
      (field) =>
        field.fieldId === fieldId &&
        field.jsonPath === path,
    ) ?? null
  );
}

function hasGenerationReason(
  candidate: CompactCandidateRecord,
  reason: string,
): boolean {
  return candidate.generationReasons.includes(
    reason,
  );
}

function isSpecialReviewableCandidate(
  candidate: CompactCandidateRecord,
): boolean {
  return candidate.generationReasons.some(
    (reason) =>
      SPECIAL_REVIEWABLE_REASONS.has(
        reason,
      ),
  );
}

function canonicalEntityOf(
  field: NormalizedSchemaField | null,
): string | null {
  return (
    field?.canonicalEntity?.entity ?? null
  );
}

function canonicalConfidenceOf(
  field: NormalizedSchemaField | null,
): string | null {
  return (
    field?.canonicalEntity?.confidence ??
    null
  );
}

function hasCanonicalEvidence(
  field: NormalizedSchemaField | null,
): boolean {
  return (
    (field?.canonicalEntity?.evidence
      .length ?? 0) > 0
  );
}

function hasDescriptionEvidence(
  field: NormalizedSchemaField | null,
): boolean {
  return (
    (field?.description.trim().length ??
      0) >= 4
  );
}

function hasSemanticEvidence(
  field: NormalizedSchemaField | null,
): boolean {
  return (
    hasCanonicalEvidence(field) ||
    hasDescriptionEvidence(field)
  );
}

function genericIdentityName(
  value: string,
): boolean {
  return GENERIC_IDENTITY_NAMES.has(
    value.trim().toLowerCase(),
  );
}

function sameCanonicalEntity(
  evidence: ResolvedCandidateEvidence,
): boolean {
  const producerEntity =
    canonicalEntityOf(
      evidence.producerField,
    );

  const consumerEntity =
    canonicalEntityOf(
      evidence.consumerField,
    );

  return (
    producerEntity !== null &&
    producerEntity === consumerEntity
  );
}

function schemaMissing(
  evidence: ResolvedCandidateEvidence,
): boolean {
  return (
    evidence.producerTool?.metadata
      .outputSchemaCompleteness ===
      "MISSING" ||
    evidence.consumerTool?.metadata
      .inputSchemaCompleteness ===
      "MISSING"
  );
}

function explicitContactResolver(
  candidate: CompactCandidateRecord,
): boolean {
  return hasGenerationReason(
    candidate,
    "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
  );
}

function pureDeterministicCollection(
  evidence: ResolvedCandidateEvidence,
): boolean {
  const { candidate } = evidence;

  return (
    candidate.primaryReason ===
      "COLLECTION_REQUIRES_SELECTION" &&
    candidate.matchedCanonicalEntity !==
      null &&
    candidate.checks.entityCompatible &&
    candidate.checks.typeCompatible &&
    candidate.checks.serviceCompatible &&
    candidate.checks
      .protocolIdentityCompatible &&
    candidate.checks
      .producerSafeForInference &&
    candidate.checks
      .producerAddsNewInformation &&
    candidate.checks.scopeStatus !==
      "CONTEXT_NOT_SHARED" &&
    canonicalConfidenceOf(
      evidence.producerField,
    ) === "HIGH" &&
    canonicalConfidenceOf(
      evidence.consumerField,
    ) === "HIGH" &&
    evidence.producerTool?.metadata
      .deprecated === false &&
    evidence.consumerTool?.metadata
      .deprecated === false &&
    evidence.producerTool?.metadata
      .outputSchemaCompleteness ===
      "COMPLETE" &&
    evidence.consumerTool?.metadata
      .inputSchemaCompleteness ===
      "COMPLETE"
  );
}

function reviewQuestions(
  candidate: CompactCandidateRecord,
): string[] {
  const questions: string[] = [];

  if (candidate.selectionRequired) {
    questions.push(
      "Does the evidence support selecting one produced item for the consumer?",
    );
  }

  if (
    candidate.disambiguationRequired
  ) {
    questions.push(
      "Can the producer and consumer meanings be disambiguated using only the supplied evidence?",
    );
  }

  if (
    candidate.transformationRequired
  ) {
    questions.push(
      "Is the required transformation explicitly supported by the stored descriptions?",
    );
  }

  if (
    candidate.checks.scopeStatus ===
    "CONTEXT_NOT_SHARED"
  ) {
    questions.push(
      "Does the stored evidence establish compatible resource scope?",
    );
  }

  if (
    candidate.primaryReason ===
    "DEPRECATED_PRODUCER"
  ) {
    questions.push(
      "Is the deprecated producer still a semantically valid source for this input?",
    );
  }

  return questions;
}

export function createEligibilityContext(
  catalog: NormalizedToolCatalog,
): EligibilityContext {
  return {
    toolsBySlug: new Map(
      catalog.tools.map((tool) => [
        tool.metadata.slug,
        tool,
      ]),
    ),
  };
}

export function resolveCandidateEvidence(
  candidate: CompactCandidateRecord,
  context: EligibilityContext,
): ResolvedCandidateEvidence {
  const producerTool =
    context.toolsBySlug.get(
      candidate.producer.toolSlug,
    ) ?? null;

  const consumerTool =
    context.toolsBySlug.get(
      candidate.consumer.toolSlug,
    ) ?? null;

  const producerField = producerTool
    ? fieldByEndpoint(
        producerTool.outputFields,
        candidate.producer.fieldId,
        candidate.producer.path,
      )
    : null;

  const consumerField = consumerTool
    ? fieldByEndpoint(
        consumerTool.inputFields,
        candidate.consumer.fieldId,
        candidate.consumer.path,
      )
    : null;

  return {
    candidate,
    producerTool,
    consumerTool,
    producerField,
    consumerField,
  };
}

export function assessCandidateEligibility(
  candidate: CompactCandidateRecord,
  context: EligibilityContext,
): EligibilityAssessment {
  const evidence =
    resolveCandidateEvidence(
      candidate,
      context,
    );

  if (!evidence.producerTool) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      ["PRODUCER_TOOL_NOT_FOUND"],
      "The producer tool is absent from the frozen normalized catalog.",
    );
  }

  if (!evidence.consumerTool) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      ["CONSUMER_TOOL_NOT_FOUND"],
      "The consumer tool is absent from the frozen normalized catalog.",
    );
  }

  if (!evidence.producerField) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      ["PRODUCER_PATH_NOT_FOUND"],
      "The exact producer field ID and path do not exist in the normalized catalog.",
    );
  }

  if (!evidence.consumerField) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      ["CONSUMER_PATH_NOT_FOUND"],
      "The exact consumer field ID and path do not exist in the normalized catalog.",
    );
  }

  if (
    candidate.hardSeparation !== null ||
    hasGenerationReason(
      candidate,
      "HARD_SEPARATION_PAIR",
    )
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      [
        "DETERMINISTIC_HARD_SEPARATION",
      ],
      "A deterministic ontology hard separation applies and cannot be overridden by an LLM.",
    );
  }

  if (
    hasGenerationReason(
      candidate,
      "GENERIC_IDENTITY_FIELD",
    )
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      [
        "DETERMINISTIC_GENERIC_FIELD_REJECTION",
      ],
      "The candidate relies on a generic identity field already designated unsafe by deterministic matching.",
    );
  }

  if (
    !candidate.checks.typeCompatible
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      ["TYPE_CONFLICT"],
      "Producer and consumer JSON types are deterministically incompatible.",
    );
  }

  if (
    !candidate.checks
      .protocolIdentityCompatible
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      [
        "PROTOCOL_IDENTITY_CONFLICT",
      ],
      "The candidate conflicts across identifier protocols, such as REST IDs and GraphQL node IDs.",
    );
  }

  if (
    !candidate.checks.serviceCompatible &&
    !explicitContactResolver(candidate)
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      ["SERVICE_CONFLICT"],
      "The producer and consumer services conflict and no reviewed cross-service resolver rule applies.",
    );
  }

  if (
    !candidate.checks
      .producerAddsNewInformation
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_HARD_CONFLICT",
      [
        "PRODUCER_ADDS_NO_NEW_INFORMATION",
      ],
      "The producer requires the same unavailable identity that it returns.",
    );
  }

  if (schemaMissing(evidence)) {
    return assessment(
      candidate,
      "INELIGIBLE_INSUFFICIENT_EVIDENCE",
      ["SCHEMA_MISSING"],
      "At least one endpoint has a missing schema, so the stored evidence cannot support adjudication.",
    );
  }

  const specialReviewable =
    isSpecialReviewableCandidate(
      candidate,
    );

  const sameEntity =
    sameCanonicalEntity(evidence);

  const producerEvidence =
    hasSemanticEvidence(
      evidence.producerField,
    );

  const consumerEvidence =
    hasSemanticEvidence(
      evidence.consumerField,
    );

  if (
    genericIdentityName(
      evidence.producerField
        .originalFieldName,
    ) &&
    genericIdentityName(
      evidence.consumerField
        .originalFieldName,
    ) &&
    !sameEntity &&
    !specialReviewable
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_INSUFFICIENT_EVIDENCE",
      [
        "GENERIC_NAMES_WITHOUT_SEMANTIC_EVIDENCE",
      ],
      "The match relies on generic identity names without a shared canonical entity or reviewed ambiguity rule.",
    );
  }

  if (
    !specialReviewable &&
    !sameEntity
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_INSUFFICIENT_EVIDENCE",
      [
        "NO_SHARED_ENTITY_EVIDENCE",
      ],
      "The stored evidence does not establish a shared canonical entity.",
    );
  }

  if (
    !producerEvidence ||
    !consumerEvidence
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_INSUFFICIENT_EVIDENCE",
      [
        "MISSING_SEMANTIC_DESCRIPTION",
      ],
      "One or both endpoints lack enough canonical or descriptive evidence for constrained adjudication.",
    );
  }

  if (
    pureDeterministicCollection(
      evidence,
    )
  ) {
    return assessment(
      candidate,
      "INELIGIBLE_LOW_VALUE",
      [
        "PURE_COLLECTION_SELECTION_ALREADY_DETERMINISTIC",
      ],
      "The deterministic matcher already proves the semantic edge and preserves the required collection selection; an LLM would add no new evidence.",
    );
  }

  if (
    candidate.primaryReason ===
      "COLLECTION_REQUIRES_SELECTION" &&
    candidate.checks.scopeStatus ===
      "CONTEXT_NOT_SHARED"
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "COLLECTION_SCOPE_REVIEWABLE",
      ],
      "The canonical entity is plausible, but collection selection and resource scope require constrained review.",
      reviewQuestions(candidate),
    );
  }

  if (
    hasGenerationReason(
      candidate,
      "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
    )
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "CONTACT_DISAMBIGUATION_REVIEWABLE",
      ],
      "The stored contact and recipient descriptions can support a constrained resolver decision while preserving explicit selection.",
      reviewQuestions(candidate),
    );
  }

  if (
    hasGenerationReason(
      candidate,
      "REPOSITORY_FULL_NAME_TRANSFORMATION",
    )
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "REPOSITORY_TRANSFORMATION_REVIEWABLE",
      ],
      "The stored evidence explicitly describes an owner/repository value that may support a reviewed transformation.",
      reviewQuestions(candidate),
    );
  }

  if (
    hasGenerationReason(
      candidate,
      "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
    )
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "ISSUE_PULL_REQUEST_AMBIGUITY_REVIEWABLE",
      ],
      "The producer explicitly returns issue-or-pull-request numbers and requires evidence-bound disambiguation.",
      reviewQuestions(candidate),
    );
  }

  if (
    candidate.primaryReason ===
    "LOW_CONFIDENCE_CANONICAL_ENTITY"
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "LOW_CONFIDENCE_ENTITY_REVIEWABLE",
      ],
      "Both endpoints contain plausible semantic evidence, but at least one canonical assignment is not high confidence.",
      reviewQuestions(candidate),
    );
  }

  if (
    candidate.primaryReason ===
    "DEPRECATED_PRODUCER"
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "DEPRECATED_PRODUCER_REVIEWABLE",
      ],
      "The producer is deprecated but the stored schema and descriptions may still support a valid dependency.",
      reviewQuestions(candidate),
    );
  }

  if (
    candidate.primaryReason ===
    "INCOMPLETE_PRODUCER_SCHEMA"
  ) {
    return assessment(
      candidate,
      "ELIGIBLE",
      [
        "PARTIAL_SCHEMA_REVIEWABLE",
      ],
      "The schema is incomplete but not missing, and the stored semantic evidence may still support a constrained decision.",
      reviewQuestions(candidate),
    );
  }

  return assessment(
    candidate,
    "INELIGIBLE_INSUFFICIENT_EVIDENCE",
    [
      "UNCERTAINTY_NOT_RESOLVABLE_FROM_STORED_EVIDENCE",
    ],
    "The uncertainty is not represented by a question that the supplied static evidence can safely resolve.",
  );
}

export function assessUncertainArtifact(
  artifact: DecisionArtifact,
  catalog: NormalizedToolCatalog,
): EligibilityAssessment[] {
  if (artifact.decision !== "UNCERTAIN") {
    throw new Error(
      `Expected UNCERTAIN artifact, received ${artifact.decision}`,
    );
  }

  const context =
    createEligibilityContext(catalog);

  return artifact.candidates.map(
    (candidate) =>
      assessCandidateEligibility(
        candidate,
        context,
      ),
  );
}