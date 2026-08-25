import type {
  CompactCandidateRecord,
  DecisionArtifact,
} from "../matching";
import type {
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
} from "../types";
import type {
  EligibilityAssessment,
} from "./eligibility";

export const ADJUDICATION_PROMPT_VERSION =
  "dependency-adjudication-v1";

export type EligibilityReportFile = {
  format:
    "adjudication-eligibility-report-v1";
  source: {
    uncertainArtifactFormat: string;
    uncertainCandidateCount: number;
    catalogFormat: string;
    catalogToolCount: number;
    toolkitVersions:
      Record<string, string>;
  };
  retainedCandidateIds: string[];
  assessments:
    EligibilityAssessment[];
};

export type EvidenceEntry = {
  reference: string;
  value: unknown;
};

export type AdjudicationEndpointEvidence = {
  tool: {
    slug: string;
    name: string;
    description: string;
    toolkit: string;
    toolkitVersion: string | null;
    service: string;
    resourceFamily: string;
    actionFamily: string;
    protocol: string;
    apiVariant: string;
    abstractionLevel: string;
    deprecated: boolean;
    schemaCompleteness: string;
  };
  field: {
    fieldId: string;
    path: string;
    sourceSchemaPath: string;
    name: string;
    jsonTypes: string[];
    required: boolean;
    arrayDepth: number;
    description: string;
    canonicalEntity:
      | NonNullable<
          NormalizedSchemaField[
            "canonicalEntity"
          ]
        >
      | null;
    safeForInference: boolean;
    safetyReasons: string[];
    possibleValueSources:
      NormalizedSchemaField[
        "possibleValueSources"
      ];
    scopes:
      NormalizedSchemaField["scopes"];
    compositions: Array<{
      kind: string;
      branchIndex: number;
      sourceSchemaPath: string;
    }>;
  };
};

export type DeterministicPriority = {
  score: 1 | 2 | 3;
  scale:
    "ORDINAL_REVIEW_PRIORITY_1_TO_3";
  basis: string[];
  isProbability: false;
  includedInModelPrompt: false;
};

export type AdjudicationRequest = {
  format: "adjudication-request-v1";
  promptVersion:
    typeof ADJUDICATION_PROMPT_VERSION;
  candidateId: string;
  source: {
    uncertainArtifactFormat: string;
    catalogFormat: string;
    toolkitVersions:
      Record<string, string>;
  };
  deterministicPriority:
    DeterministicPriority;
  deterministicAnalysis: {
    primaryReason:
      CompactCandidateRecord[
        "primaryReason"
      ];
    generationReasons: string[];
    matchedCanonicalEntity:
      string | null;
    reasonCodes: string[];
    selectionRequired: boolean;
    disambiguationRequired: boolean;
    transformationRequired: boolean;
    checks:
      CompactCandidateRecord["checks"];
  };
  eligibility: {
    reasonCodes: string[];
    explanation: string;
    resolvableQuestions: string[];
    semanticCluster:
      string | null;
  };
  producer:
    AdjudicationEndpointEvidence;
  consumer:
    AdjudicationEndpointEvidence;
  evidence: EvidenceEntry[];
  allowedEvidenceReferences: string[];
};

function findField(
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

function endpointEvidence(
  tool: NormalizedTool,
  field: NormalizedSchemaField,
  direction: "producer" | "consumer",
): AdjudicationEndpointEvidence {
  return {
    tool: {
      slug: tool.metadata.slug,
      name: tool.metadata.name,
      description:
        tool.metadata.description,
      toolkit: tool.metadata.toolkit,
      toolkitVersion:
        tool.metadata.toolkitVersion,
      service:
        tool.metadata.underlyingService,
      resourceFamily:
        tool.metadata.resourceFamily,
      actionFamily:
        tool.metadata.actionFamily,
      protocol: tool.metadata.protocol,
      apiVariant:
        tool.metadata.apiVariant,
      abstractionLevel:
        tool.metadata.abstractionLevel,
      deprecated:
        tool.metadata.deprecated,
      schemaCompleteness:
        direction === "producer"
          ? tool.metadata
              .outputSchemaCompleteness
          : tool.metadata
              .inputSchemaCompleteness,
    },
    field: {
      fieldId: field.fieldId,
      path: field.jsonPath,
      sourceSchemaPath:
        field.sourceSchemaPath,
      name: field.originalFieldName,
      jsonTypes: [...field.jsonTypes],
      required:
        field.effectivelyRequired,
      arrayDepth: field.arrayDepth,
      description: field.description,
      canonicalEntity:
        field.canonicalEntity ?? null,
      safeForInference:
        field.safeForInference,
      safetyReasons: [
        ...field.safetyReasons,
      ],
      possibleValueSources:
        field.possibleValueSources,
      scopes: field.scopes,
      compositions:
        field.compositions.map(
          (composition) => ({
            kind: composition.kind,
            branchIndex:
              composition.branchIndex,
            sourceSchemaPath:
              composition.sourceSchemaPath,
          }),
        ),
    },
  };
}

function endpointEvidenceEntries(
  prefix: "producer" | "consumer",
  endpoint:
    AdjudicationEndpointEvidence,
): EvidenceEntry[] {
  return [
    {
      reference: `${prefix}.tool.slug`,
      value: endpoint.tool.slug,
    },
    {
      reference: `${prefix}.tool.name`,
      value: endpoint.tool.name,
    },
    {
      reference:
        `${prefix}.tool.description`,
      value:
        endpoint.tool.description,
    },
    {
      reference:
        `${prefix}.tool.service`,
      value: endpoint.tool.service,
    },
    {
      reference:
        `${prefix}.tool.resourceFamily`,
      value:
        endpoint.tool.resourceFamily,
    },
    {
      reference:
        `${prefix}.tool.actionFamily`,
      value:
        endpoint.tool.actionFamily,
    },
    {
      reference:
        `${prefix}.tool.protocol`,
      value: endpoint.tool.protocol,
    },
    {
      reference:
        `${prefix}.tool.apiVariant`,
      value: endpoint.tool.apiVariant,
    },
    {
      reference:
        `${prefix}.tool.abstractionLevel`,
      value:
        endpoint.tool.abstractionLevel,
    },
    {
      reference:
        `${prefix}.tool.deprecated`,
      value: endpoint.tool.deprecated,
    },
    {
      reference:
        `${prefix}.tool.schemaCompleteness`,
      value:
        endpoint.tool.schemaCompleteness,
    },
    {
      reference:
        `${prefix}.field.fieldId`,
      value: endpoint.field.fieldId,
    },
    {
      reference:
        `${prefix}.field.path`,
      value: endpoint.field.path,
    },
    {
      reference:
        `${prefix}.field.sourceSchemaPath`,
      value:
        endpoint.field.sourceSchemaPath,
    },
    {
      reference:
        `${prefix}.field.name`,
      value: endpoint.field.name,
    },
    {
      reference:
        `${prefix}.field.jsonTypes`,
      value: endpoint.field.jsonTypes,
    },
    {
      reference:
        `${prefix}.field.required`,
      value: endpoint.field.required,
    },
    {
      reference:
        `${prefix}.field.arrayDepth`,
      value: endpoint.field.arrayDepth,
    },
    {
      reference:
        `${prefix}.field.description`,
      value:
        endpoint.field.description,
    },
    {
      reference:
        `${prefix}.field.canonicalEntity`,
      value:
        endpoint.field.canonicalEntity,
    },
    {
      reference:
        `${prefix}.field.safety`,
      value: {
        safeForInference:
          endpoint.field
            .safeForInference,
        safetyReasons:
          endpoint.field.safetyReasons,
      },
    },
    {
      reference:
        `${prefix}.field.valueSources`,
      value:
        endpoint.field
          .possibleValueSources,
    },
    {
      reference:
        `${prefix}.field.scopes`,
      value: endpoint.field.scopes,
    },
    {
      reference:
        `${prefix}.field.compositions`,
      value:
        endpoint.field.compositions,
    },
  ];
}

function candidateEvidenceEntries(
  candidate: CompactCandidateRecord,
): EvidenceEntry[] {
  return [
    {
      reference:
        "candidate.primaryReason",
      value: candidate.primaryReason,
    },
    {
      reference:
        "candidate.generationReasons",
      value:
        candidate.generationReasons,
    },
    {
      reference:
        "candidate.matchedCanonicalEntity",
      value:
        candidate.matchedCanonicalEntity,
    },
    {
      reference:
        "candidate.reasonCodes",
      value: candidate.reasonCodes,
    },
    {
      reference:
        "candidate.flags.selectionRequired",
      value:
        candidate.selectionRequired,
    },
    {
      reference:
        "candidate.flags.disambiguationRequired",
      value:
        candidate
          .disambiguationRequired,
    },
    {
      reference:
        "candidate.flags.transformationRequired",
      value:
        candidate
          .transformationRequired,
    },
    {
      reference:
        "candidate.checks",
      value: candidate.checks,
    },
  ];
}

function deterministicPriority(
  candidate: CompactCandidateRecord,
): DeterministicPriority {
  const basis: string[] = [];

  let score: 1 | 2 | 3 = 1;

  if (
    candidate.generationReasons.some(
      (reason) =>
        [
          "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
          "REPOSITORY_FULL_NAME_TRANSFORMATION",
          "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
        ].includes(reason),
    )
  ) {
    score = 3;
    basis.push(
      "SPECIAL_REVIEWABLE_AMBIGUITY",
    );
  }

  if (
    score < 3 &&
    (
      candidate.primaryReason ===
        "LOW_CONFIDENCE_CANONICAL_ENTITY" ||
      candidate.primaryReason ===
        "DEPRECATED_PRODUCER" ||
      candidate.primaryReason ===
        "INCOMPLETE_PRODUCER_SCHEMA" ||
      candidate.checks.scopeStatus ===
        "CONTEXT_NOT_SHARED"
    )
  ) {
    score = 2;
    basis.push(
      "SEMANTIC_OR_SCOPE_REVIEW",
    );
  }

  if (basis.length === 0) {
    basis.push(
      "STANDARD_ELIGIBLE_REVIEW",
    );
  }

  return {
    score,
    scale:
      "ORDINAL_REVIEW_PRIORITY_1_TO_3",
    basis,
    isProbability: false,
    includedInModelPrompt: false,
  };
}

export function buildAdjudicationRequest(
  candidateId: string,
  uncertain: DecisionArtifact,
  eligibility:
    EligibilityReportFile,
  catalog: NormalizedToolCatalog,
): AdjudicationRequest {
  if (
    uncertain.decision !==
    "UNCERTAIN"
  ) {
    throw new Error(
      `Expected UNCERTAIN artifact, received ${uncertain.decision}`,
    );
  }

  if (
    eligibility.format !==
    "adjudication-eligibility-report-v1"
  ) {
    throw new Error(
      `Unsupported eligibility report: ${eligibility.format}`,
    );
  }

  if (
    !eligibility.retainedCandidateIds
      .includes(candidateId)
  ) {
    throw new Error(
      `Candidate is not retained as eligible: ${candidateId}`,
    );
  }

  const assessment =
    eligibility.assessments.find(
      (item) =>
        item.candidateId ===
        candidateId,
    );

  if (
    !assessment ||
    assessment.category !==
      "ELIGIBLE"
  ) {
    throw new Error(
      `Candidate does not have a final ELIGIBLE assessment: ${candidateId}`,
    );
  }

  const candidate =
    uncertain.candidates.find(
      (item) => item.id === candidateId,
    );

  if (!candidate) {
    throw new Error(
      `Candidate does not exist in the uncertain artifact: ${candidateId}`,
    );
  }

  const toolsBySlug = new Map(
    catalog.tools.map((tool) => [
      tool.metadata.slug,
      tool,
    ]),
  );

  const producerTool =
    toolsBySlug.get(
      candidate.producer.toolSlug,
    );

  const consumerTool =
    toolsBySlug.get(
      candidate.consumer.toolSlug,
    );

  if (!producerTool) {
    throw new Error(
      `Producer tool not found: ${candidate.producer.toolSlug}`,
    );
  }

  if (!consumerTool) {
    throw new Error(
      `Consumer tool not found: ${candidate.consumer.toolSlug}`,
    );
  }

  const producerField = findField(
    producerTool.outputFields,
    candidate.producer.fieldId,
    candidate.producer.path,
  );

  const consumerField = findField(
    consumerTool.inputFields,
    candidate.consumer.fieldId,
    candidate.consumer.path,
  );

  if (!producerField) {
    throw new Error(
      `Producer field not found: ${candidate.producer.fieldId}`,
    );
  }

  if (!consumerField) {
    throw new Error(
      `Consumer field not found: ${candidate.consumer.fieldId}`,
    );
  }

  const producer = endpointEvidence(
    producerTool,
    producerField,
    "producer",
  );

  const consumer = endpointEvidence(
    consumerTool,
    consumerField,
    "consumer",
  );

  const evidence = [
    ...candidateEvidenceEntries(
      candidate,
    ),
    ...endpointEvidenceEntries(
      "producer",
      producer,
    ),
    ...endpointEvidenceEntries(
      "consumer",
      consumer,
    ),
  ];

  const references =
    evidence.map(
      (entry) => entry.reference,
    );

  if (
    new Set(references).size !==
    references.length
  ) {
    throw new Error(
      `Duplicate evidence reference for candidate ${candidateId}`,
    );
  }

  return {
    format:
      "adjudication-request-v1",
    promptVersion:
      ADJUDICATION_PROMPT_VERSION,
    candidateId,
    source: {
      uncertainArtifactFormat:
        uncertain.format,
      catalogFormat: catalog.format,
      toolkitVersions: {
        ...uncertain.generatedFrom
          .toolkitVersions,
      },
    },
    deterministicPriority:
      deterministicPriority(candidate),
    deterministicAnalysis: {
      primaryReason:
        candidate.primaryReason,
      generationReasons: [
        ...candidate.generationReasons,
      ],
      matchedCanonicalEntity:
        candidate
          .matchedCanonicalEntity,
      reasonCodes: [
        ...candidate.reasonCodes,
      ],
      selectionRequired:
        candidate.selectionRequired,
      disambiguationRequired:
        candidate
          .disambiguationRequired,
      transformationRequired:
        candidate
          .transformationRequired,
      checks: candidate.checks,
    },
    eligibility: {
      reasonCodes: [
        ...assessment.reasonCodes,
      ],
      explanation:
        assessment.explanation,
      resolvableQuestions: [
        ...assessment
          .resolvableQuestions,
      ],
      semanticCluster:
        assessment.semanticCluster ??
        null,
    },
    producer,
    consumer,
    evidence,
    allowedEvidenceReferences:
      references,
  };
}