import type {
  NormalizedToolCatalog,
} from "../types";
import type {
  CandidateEvaluation,
  EvaluatedDependencyCandidate,
  EvaluationReason,
} from "./evaluator";

export type GoldFixtureCase = {
  id: string;
  category:
    | "positive"
    | "negative"
    | "ambiguous";
  producerTool: string;
  producerOutputPath: string;
  consumerTool: string;
  consumerInputPath: string;
  expectedDecision:
    | "ACCEPTED"
    | "UNCERTAIN"
    | "REJECTED";
  expectedReason: string;
  expectedSelectionRequired: boolean;
  expectedTransformationRequired: boolean;
  expectedDisambiguationRequired: boolean;
};

export type GoldFixture = {
  format: string;
  cases: GoldFixtureCase[];
};

export type CompactEndpoint = {
  toolSlug: string;
  fieldId: string;
  path: string;
  fieldName: string;
  jsonTypes: string[];
  canonicalEntity: string | null;
  canonicalConfidence: string | null;
  safeForInference: boolean;
  arrayDepth: number;
  effectivelyRequired: boolean;
  toolkit: string;
  service: string;
  resourceFamily: string;
  protocol: string;
  deprecated: boolean;
  schemaCompleteness: string;
};

export type CompactCandidateRecord = {
  id: string;
  producer: CompactEndpoint;
  consumer: CompactEndpoint;
  generationReasons: string[];
  matchedCanonicalEntity: string | null;
  hardSeparation: {
    left: string;
    right: string;
    reason: string;
  } | null;
  primaryReason: EvaluationReason;
  reasonCodes: string[];
  selectionRequired: boolean;
  transformationRequired: boolean;
  disambiguationRequired: boolean;
  checks: CandidateEvaluation["checks"];
};

export type DecisionArtifact = {
  format: "dependency-candidate-decisions-v1";
  decision:
    | "ACCEPTED"
    | "UNCERTAIN"
    | "REJECTED";
  generatedFrom: {
    catalogFormat: string;
    toolCount: number;
    toolkitCounts: Record<string, number>;
    toolkitVersions: Record<string, string>;
  };
  summary: {
    candidateCount: number;
    reasonCounts: Record<string, number>;
    selectionRequiredCount: number;
    transformationRequiredCount: number;
    disambiguationRequiredCount: number;
  };
  candidates: CompactCandidateRecord[];
};

export type GoldValidation = {
  totalCases: number;
  generatedCases: number;
  missingCases: string[];
  decisionMatches: number;
  reasonMatches: number;
  flagMatches: number;
  positiveCases: number;
  positiveAccepted: number;
  falseNegatives: string[];
  positiveRecall: number;
  negativeCases: number;
  negativeRejected: number;
  falsePositives: string[];
  negativeRejectionRate: number;
  ambiguousCases: number;
  ambiguousIncorrectlyAccepted: string[];
};

export type ValidationReport = {
  format: "validation-report-initial-v1";
  source: {
    catalogFormat: string;
    toolCount: number;
    toolkitCounts: Record<string, number>;
    toolkitVersions: Record<string, string>;
    fixtureFormat: string;
    fixtureCaseCount: number;
  };
  candidateGeneration: {
    candidateCount: number;
    generationReasonCounts:
      Record<string, number>;
  };
  decisions: {
    accepted: number;
    uncertain: number;
    rejected: number;
    decisionReasonCounts:
      Record<string, number>;
  };
  safetyAndWorkflow: {
    genericFieldRejections: number;
    sameInformationRejections: number;
    serviceMismatchRejections: number;
    typeMismatchRejections: number;
    entityMismatchRejections: number;
    protocolIdentityMismatchRejections: number;
    selectionRequired: number;
    disambiguationRequired: number;
    transformationRequired: number;
    deprecatedProducerUncertain: number;
    incompleteSchemaUncertain: number;
  };
  goldEvaluation: GoldValidation;
  invariants: {
    everyCandidatePartitionedExactlyOnce: boolean;
    decisionFilesSortedByCandidateId: boolean;
    noAmbiguousCaseAccepted: boolean;
    noGoldCaseMissing: boolean;
  };
};

export type BuiltArtifacts = {
  accepted: DecisionArtifact;
  uncertain: DecisionArtifact;
  rejected: DecisionArtifact;
  validationReport: ValidationReport;
};

function increment(
  counts: Record<string, number>,
  key: string,
): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function endpoint(
  value: EvaluatedDependencyCandidate[
    "candidate"
  ]["producer"],
): CompactEndpoint {
  return {
    toolSlug: value.toolSlug,
    fieldId: value.fieldId,
    path: value.path,
    fieldName: value.fieldName,
    jsonTypes: [...value.jsonTypes],
    canonicalEntity: value.canonicalEntity,
    canonicalConfidence:
      value.canonicalConfidence,
    safeForInference:
      value.safeForInference,
    arrayDepth: value.arrayDepth,
    effectivelyRequired:
      value.effectivelyRequired,
    toolkit: value.toolkit,
    service: value.service,
    resourceFamily: value.resourceFamily,
    protocol: value.protocol,
    deprecated: value.deprecated,
    schemaCompleteness:
      value.schemaCompleteness,
  };
}

function compactRecord(
  evaluated: EvaluatedDependencyCandidate,
): CompactCandidateRecord {
  return {
    id: evaluated.candidate.id,
    producer: endpoint(
      evaluated.candidate.producer,
    ),
    consumer: endpoint(
      evaluated.candidate.consumer,
    ),
    generationReasons: [
      ...evaluated.candidate.generationReasons,
    ],
    matchedCanonicalEntity:
      evaluated.candidate
        .matchedCanonicalEntity,
    hardSeparation:
      evaluated.candidate.hardSeparation,
    primaryReason:
      evaluated.evaluation.primaryReason,
    reasonCodes: [
      ...evaluated.evaluation.reasonCodes,
    ],
    selectionRequired:
      evaluated.evaluation.selectionRequired,
    transformationRequired:
      evaluated.evaluation
        .transformationRequired,
    disambiguationRequired:
      evaluated.evaluation
        .disambiguationRequired,
    checks: evaluated.evaluation.checks,
  };
}

function toolkitVersions(
  catalog: NormalizedToolCatalog,
): Record<string, string> {
  return Object.fromEntries(
    catalog.sourceFiles
      .filter(
        (
          source,
        ): source is typeof source & {
          toolkitVersion: string;
        } =>
          source.toolkitVersion !== null,
      )
      .map(
        (source): [string, string] => [
          source.toolkit,
          source.toolkitVersion,
        ],
      )
      .sort(([left], [right]) =>
        left < right
          ? -1
          : left > right
            ? 1
            : 0,
      ),
  );
}

function generatedFrom(
  catalog: NormalizedToolCatalog,
): DecisionArtifact["generatedFrom"] {
  return {
    catalogFormat: catalog.format,
    toolCount: catalog.summary.toolCount,
    toolkitCounts: {
      ...catalog.summary.toolsByToolkit,
    },
    toolkitVersions:
      toolkitVersions(catalog),
  };
}

function decisionArtifact(
  decision:
    | "ACCEPTED"
    | "UNCERTAIN"
    | "REJECTED",
  records: CompactCandidateRecord[],
  catalog: NormalizedToolCatalog,
): DecisionArtifact {
  const reasonCounts:
    Record<string, number> = {};

  let selectionRequiredCount = 0;
  let transformationRequiredCount = 0;
  let disambiguationRequiredCount = 0;

  for (const record of records) {
    increment(
      reasonCounts,
      record.primaryReason,
    );

    if (record.selectionRequired) {
      selectionRequiredCount += 1;
    }

    if (record.transformationRequired) {
      transformationRequiredCount += 1;
    }

    if (record.disambiguationRequired) {
      disambiguationRequiredCount += 1;
    }
  }

  return {
    format:
      "dependency-candidate-decisions-v1",
    decision,
    generatedFrom:
      generatedFrom(catalog),
    summary: {
      candidateCount: records.length,
      reasonCounts,
      selectionRequiredCount,
      transformationRequiredCount,
      disambiguationRequiredCount,
    },
    candidates: records,
  };
}

export function candidatePairKey(
  producerTool: string,
  producerPath: string,
  consumerTool: string,
  consumerPath: string,
): string {
  return [
    producerTool,
    producerPath,
    consumerTool,
    consumerPath,
  ].join("|");
}

function goldValidation(
  evaluated:
    EvaluatedDependencyCandidate[],
  fixture: GoldFixture,
): GoldValidation {
  const byPair = new Map(
    evaluated.map((item) => [
      candidatePairKey(
        item.candidate.producer.toolSlug,
        item.candidate.producer.path,
        item.candidate.consumer.toolSlug,
        item.candidate.consumer.path,
      ),
      item,
    ]),
  );

  const missingCases: string[] = [];
  const falseNegatives: string[] = [];
  const falsePositives: string[] = [];
  const ambiguousIncorrectlyAccepted:
    string[] = [];

  let generatedCases = 0;
  let decisionMatches = 0;
  let reasonMatches = 0;
  let flagMatches = 0;
  let positiveCases = 0;
  let positiveAccepted = 0;
  let negativeCases = 0;
  let negativeRejected = 0;
  let ambiguousCases = 0;

  for (const expected of fixture.cases) {
    const actual = byPair.get(
      candidatePairKey(
        expected.producerTool,
        expected.producerOutputPath,
        expected.consumerTool,
        expected.consumerInputPath,
      ),
    );

    if (!actual) {
      missingCases.push(expected.id);
      continue;
    }

    generatedCases += 1;

    if (
      actual.evaluation.decision ===
      expected.expectedDecision
    ) {
      decisionMatches += 1;
    }

    if (
      actual.evaluation.primaryReason ===
      expected.expectedReason
    ) {
      reasonMatches += 1;
    }

    if (
      actual.evaluation.selectionRequired ===
        expected.expectedSelectionRequired &&
      actual.evaluation
        .transformationRequired ===
        expected.expectedTransformationRequired &&
      actual.evaluation
        .disambiguationRequired ===
        expected.expectedDisambiguationRequired
    ) {
      flagMatches += 1;
    }

    if (expected.category === "positive") {
      positiveCases += 1;

      if (
        actual.evaluation.decision ===
        "ACCEPTED"
      ) {
        positiveAccepted += 1;
      } else {
        falseNegatives.push(expected.id);
      }
    } else if (
      expected.category === "negative"
    ) {
      negativeCases += 1;

      if (
        actual.evaluation.decision ===
        "REJECTED"
      ) {
        negativeRejected += 1;
      } else if (
        actual.evaluation.decision ===
        "ACCEPTED"
      ) {
        falsePositives.push(expected.id);
      }
    } else {
      ambiguousCases += 1;

      if (
        actual.evaluation.decision ===
        "ACCEPTED"
      ) {
        ambiguousIncorrectlyAccepted.push(
          expected.id,
        );
      }
    }
  }

  return {
    totalCases: fixture.cases.length,
    generatedCases,
    missingCases,
    decisionMatches,
    reasonMatches,
    flagMatches,
    positiveCases,
    positiveAccepted,
    falseNegatives,
    positiveRecall:
      positiveCases === 0
        ? 0
        : positiveAccepted / positiveCases,
    negativeCases,
    negativeRejected,
    falsePositives,
    negativeRejectionRate:
      negativeCases === 0
        ? 0
        : negativeRejected / negativeCases,
    ambiguousCases,
    ambiguousIncorrectlyAccepted,
  };
}

function allSorted(
  files: DecisionArtifact[],
): boolean {
  return files.every((file) =>
    file.candidates.every(
      (candidate, index) =>
        index === 0 ||
        file.candidates[index - 1].id <
          candidate.id,
    ),
  );
}

function validationReport(
  evaluated:
    EvaluatedDependencyCandidate[],
  fixture: GoldFixture,
  catalog: NormalizedToolCatalog,
  accepted: DecisionArtifact,
  uncertain: DecisionArtifact,
  rejected: DecisionArtifact,
): ValidationReport {
  const generationReasonCounts:
    Record<string, number> = {};

  const decisionReasonCounts:
    Record<string, number> = {};

  for (const item of evaluated) {
    for (
      const reason of
      item.candidate.generationReasons
    ) {
      increment(
        generationReasonCounts,
        reason,
      );
    }

    increment(
      decisionReasonCounts,
      item.evaluation.primaryReason,
    );
  }

  const countReason = (
    reason: EvaluationReason,
  ): number =>
    decisionReasonCounts[reason] ?? 0;

  const selectionRequired =
    evaluated.filter(
      (item) =>
        item.evaluation.selectionRequired,
    ).length;

  const disambiguationRequired =
    evaluated.filter(
      (item) =>
        item.evaluation
          .disambiguationRequired,
    ).length;

  const transformationRequired =
    evaluated.filter(
      (item) =>
        item.evaluation
          .transformationRequired,
    ).length;

  const gold = goldValidation(
    evaluated,
    fixture,
  );

  const partitionedIds = new Set([
    ...accepted.candidates.map(
      (candidate) => candidate.id,
    ),
    ...uncertain.candidates.map(
      (candidate) => candidate.id,
    ),
    ...rejected.candidates.map(
      (candidate) => candidate.id,
    ),
  ]);

  return {
    format:
      "validation-report-initial-v1",
    source: {
      catalogFormat: catalog.format,
      toolCount:
        catalog.summary.toolCount,
      toolkitCounts: {
        ...catalog.summary.toolsByToolkit,
      },
      toolkitVersions:
        toolkitVersions(catalog),
      fixtureFormat: fixture.format,
      fixtureCaseCount:
        fixture.cases.length,
    },
    candidateGeneration: {
      candidateCount: evaluated.length,
      generationReasonCounts,
    },
    decisions: {
      accepted:
        accepted.summary.candidateCount,
      uncertain:
        uncertain.summary.candidateCount,
      rejected:
        rejected.summary.candidateCount,
      decisionReasonCounts,
    },
    safetyAndWorkflow: {
      genericFieldRejections:
        countReason(
          "GENERIC_FIELD_WITHOUT_RESOURCE_EVIDENCE",
        ),
      sameInformationRejections:
        countReason(
          "PRODUCER_ADDS_NO_NEW_INFORMATION",
        ),
      serviceMismatchRejections:
        countReason("SERVICE_MISMATCH"),
      typeMismatchRejections:
        countReason("TYPE_MISMATCH"),
      entityMismatchRejections:
        countReason("ENTITY_MISMATCH"),
      protocolIdentityMismatchRejections:
        countReason(
          "PROTOCOL_IDENTITY_MISMATCH",
        ),
      selectionRequired,
      disambiguationRequired,
      transformationRequired,
      deprecatedProducerUncertain:
        countReason(
          "DEPRECATED_PRODUCER",
        ),
      incompleteSchemaUncertain:
        countReason(
          "INCOMPLETE_PRODUCER_SCHEMA",
        ),
    },
    goldEvaluation: gold,
    invariants: {
      everyCandidatePartitionedExactlyOnce:
        partitionedIds.size ===
          evaluated.length &&
        accepted.summary.candidateCount +
          uncertain.summary.candidateCount +
          rejected.summary.candidateCount ===
          evaluated.length,
      decisionFilesSortedByCandidateId:
        allSorted([
          accepted,
          uncertain,
          rejected,
        ]),
      noAmbiguousCaseAccepted:
        gold
          .ambiguousIncorrectlyAccepted
          .length === 0,
      noGoldCaseMissing:
        gold.missingCases.length === 0,
    },
  };
}

export function buildDecisionArtifacts(
  evaluated:
    EvaluatedDependencyCandidate[],
  catalog: NormalizedToolCatalog,
  fixture: GoldFixture,
): BuiltArtifacts {
  const acceptedRecords:
    CompactCandidateRecord[] = [];

  const uncertainRecords:
    CompactCandidateRecord[] = [];

  const rejectedRecords:
    CompactCandidateRecord[] = [];

  for (const item of evaluated) {
    const record = compactRecord(item);

    if (
      item.evaluation.decision ===
      "ACCEPTED"
    ) {
      acceptedRecords.push(record);
    } else if (
      item.evaluation.decision ===
      "UNCERTAIN"
    ) {
      uncertainRecords.push(record);
    } else {
      rejectedRecords.push(record);
    }
  }

  const sortRecords = (
    records: CompactCandidateRecord[],
  ): void => {
    records.sort((left, right) =>
      left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
    );
  };

  sortRecords(acceptedRecords);
  sortRecords(uncertainRecords);
  sortRecords(rejectedRecords);

  const accepted = decisionArtifact(
    "ACCEPTED",
    acceptedRecords,
    catalog,
  );

  const uncertain = decisionArtifact(
    "UNCERTAIN",
    uncertainRecords,
    catalog,
  );

  const rejected = decisionArtifact(
    "REJECTED",
    rejectedRecords,
    catalog,
  );

  return {
    accepted,
    uncertain,
    rejected,
    validationReport:
      validationReport(
        evaluated,
        fixture,
        catalog,
        accepted,
        uncertain,
        rejected,
      ),
  };
}
