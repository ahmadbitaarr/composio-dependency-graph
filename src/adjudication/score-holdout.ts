import type {
  AdjudicationExecutionResult,
} from "./client";
import type {
  AdjudicationDecision,
} from "./schema";

export type HoldoutExpectedDecision =
  AdjudicationDecision["decision"];

export type HoldoutExpectedDependencyKind =
  AdjudicationDecision[
    "dependencyKind"
  ];

export type AdjudicationHoldoutCase = {
  id: string;
  candidateId: string;
  toolkit:
    | "github"
    | "googlesuper";
  sourcePrimaryReason: string;
  expectedDecision:
    HoldoutExpectedDecision;
  expectedDependencyKind:
    HoldoutExpectedDependencyKind;
  expectedSelectionRequired:
    boolean;
  expectedDisambiguationRequired:
    boolean;
  expectedTransformationRequired:
    boolean;
  rationale: string;
};

export type AdjudicationHoldoutFile = {
  format:
    "adjudication-holdout-v1";
  generatedFrom:
    Record<string, unknown>;
  summary:
    Record<string, unknown>;
  cases:
    AdjudicationHoldoutCase[];
};

export type HoldoutCaseScoreStatus =
  | "SCORED"
  | "INVALID_RESPONSE"
  | "TRANSPORT_FAILURE"
  | "DRY_RUN"
  | "MISSING_RESULT";

export type AdjudicationHoldoutCaseScore = {
  id: string;
  candidateId: string;
  toolkit:
    | "github"
    | "googlesuper";
  status:
    HoldoutCaseScoreStatus;
  expectedDecision:
    HoldoutExpectedDecision;
  actualDecision:
    HoldoutExpectedDecision | null;
  decisionMatches: boolean;
  expectedDependencyKind:
    HoldoutExpectedDependencyKind;
  actualDependencyKind:
    HoldoutExpectedDependencyKind | null;
  dependencyKindMatches:
    boolean;
  selectionMatches: boolean;
  disambiguationMatches:
    boolean;
  transformationMatches:
    boolean;
};

export type MetricRatio = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export type AdjudicationHoldoutScore = {
  format:
    "adjudication-holdout-score-v1";
  holdoutFormat:
    AdjudicationHoldoutFile[
      "format"
    ];
  totalCases: number;
  validDecisionCount: number;
  coverage:
    MetricRatio;
  invalidResponseCount: number;
  transportFailureCount: number;
  dryRunResultCount: number;
  missingResultCount: number;
  decisions: {
    exactMatchCount: number;
    accuracy:
      MetricRatio;
    accept: {
      expectedCount: number;
      predictedCount: number;
      correctCount: number;
      unsupportedAcceptCount:
        number;
      precision:
        MetricRatio;
      recall:
        MetricRatio;
    };
    reject: {
      expectedCount: number;
      predictedCount: number;
      correctCount: number;
      incorrectCount: number;
      accuracy:
        MetricRatio;
    };
    abstain: {
      expectedCount: number;
      predictedCount: number;
      correctCount: number;
      incorrectCount: number;
      recall:
        MetricRatio;
    };
  };
  dependencyKind: {
    evaluatedCount: number;
    matchCount: number;
    matchRate:
      MetricRatio;
  };
  flags: {
    selection: {
      evaluatedCount: number;
      matchCount: number;
      matchRate:
        MetricRatio;
    };
    disambiguation: {
      evaluatedCount: number;
      matchCount: number;
      matchRate:
        MetricRatio;
    };
    transformation: {
      evaluatedCount: number;
      matchCount: number;
      matchRate:
        MetricRatio;
    };
  };
  caseResults:
    AdjudicationHoldoutCaseScore[];
};

function ratio(
  numerator: number,
  denominator: number,
): MetricRatio {
  return {
    numerator,
    denominator,
    rate:
      denominator === 0
        ? null
        : numerator /
          denominator,
  };
}

function validateHoldout(
  holdout:
    AdjudicationHoldoutFile,
): void {
  if (
    holdout.format !==
    "adjudication-holdout-v1"
  ) {
    throw new Error(
      `Unsupported holdout format: ${holdout.format}`,
    );
  }

  const candidateIds =
    holdout.cases.map(
      (holdoutCase) =>
        holdoutCase.candidateId,
    );

  if (
    new Set(candidateIds).size !==
    candidateIds.length
  ) {
    throw new Error(
      "Holdout contains duplicate candidate IDs.",
    );
  }

  const caseIds =
    holdout.cases.map(
      (holdoutCase) =>
        holdoutCase.id,
    );

  if (
    new Set(caseIds).size !==
    caseIds.length
  ) {
    throw new Error(
      "Holdout contains duplicate case IDs.",
    );
  }
}

function decisionFromResult(
  candidateId: string,
  result:
    AdjudicationExecutionResult
    | undefined,
): {
  status:
    HoldoutCaseScoreStatus;
  decision:
    AdjudicationDecision | null;
} {
  if (!result) {
    return {
      status:
        "MISSING_RESULT",
      decision: null,
    };
  }

  if (
    result.candidateId !==
    candidateId
  ) {
    return {
      status:
        "INVALID_RESPONSE",
      decision: null,
    };
  }

  switch (result.status) {
    case "COMPLETED":
    case "CACHE_HIT": {
      const decision =
        result.record.decision;

      if (
        decision.candidateId !==
        candidateId
      ) {
        return {
          status:
            "INVALID_RESPONSE",
          decision: null,
        };
      }

      return {
        status: "SCORED",
        decision,
      };
    }

    case "FAILED":
      return {
        status:
          result.failure.code ===
          "INVALID_MODEL_RESPONSE"
            ? "INVALID_RESPONSE"
            : "TRANSPORT_FAILURE",
        decision: null,
      };

    case "DRY_RUN":
      return {
        status: "DRY_RUN",
        decision: null,
      };
  }
}

export function scoreAdjudicationHoldout(
  holdout:
    AdjudicationHoldoutFile,
  results: Record<
    string,
    AdjudicationExecutionResult
  >,
): AdjudicationHoldoutScore {
  validateHoldout(holdout);

  let validDecisionCount = 0;
  let invalidResponseCount = 0;
  let transportFailureCount = 0;
  let dryRunResultCount = 0;
  let missingResultCount = 0;

  let exactDecisionMatchCount = 0;

  let expectedAcceptCount = 0;
  let predictedAcceptCount = 0;
  let correctAcceptCount = 0;
  let unsupportedAcceptCount = 0;

  let expectedRejectCount = 0;
  let predictedRejectCount = 0;
  let correctRejectCount = 0;
  let incorrectRejectCount = 0;

  let expectedAbstainCount = 0;
  let predictedAbstainCount = 0;
  let correctAbstainCount = 0;
  let incorrectAbstainCount = 0;

  let dependencyKindMatchCount = 0;
  let selectionMatchCount = 0;
  let disambiguationMatchCount = 0;
  let transformationMatchCount = 0;

  const caseResults:
    AdjudicationHoldoutCaseScore[] =
    [];

  for (
    const holdoutCase
    of holdout.cases
  ) {
    switch (
      holdoutCase.expectedDecision
    ) {
      case "ACCEPT":
        expectedAcceptCount += 1;
        break;

      case "REJECT":
        expectedRejectCount += 1;
        break;

      case "ABSTAIN":
        expectedAbstainCount += 1;
        break;
    }

    const extracted =
      decisionFromResult(
        holdoutCase.candidateId,
        results[
          holdoutCase.candidateId
        ],
      );

    if (
      extracted.status ===
      "INVALID_RESPONSE"
    ) {
      invalidResponseCount += 1;
    }

    if (
      extracted.status ===
      "TRANSPORT_FAILURE"
    ) {
      transportFailureCount += 1;
    }

    if (
      extracted.status ===
      "DRY_RUN"
    ) {
      dryRunResultCount += 1;
    }

    if (
      extracted.status ===
      "MISSING_RESULT"
    ) {
      missingResultCount += 1;
    }

    const decision =
      extracted.decision;

    if (!decision) {
      caseResults.push({
        id: holdoutCase.id,
        candidateId:
          holdoutCase.candidateId,
        toolkit:
          holdoutCase.toolkit,
        status:
          extracted.status,
        expectedDecision:
          holdoutCase
            .expectedDecision,
        actualDecision: null,
        decisionMatches: false,
        expectedDependencyKind:
          holdoutCase
            .expectedDependencyKind,
        actualDependencyKind:
          null,
        dependencyKindMatches:
          false,
        selectionMatches: false,
        disambiguationMatches:
          false,
        transformationMatches:
          false,
      });

      continue;
    }

    validDecisionCount += 1;

    const decisionMatches =
      decision.decision ===
      holdoutCase
        .expectedDecision;

    const dependencyKindMatches =
      decision.dependencyKind ===
      holdoutCase
        .expectedDependencyKind;

    const selectionMatches =
      decision.requiresSelection ===
      holdoutCase
        .expectedSelectionRequired;

    const disambiguationMatches =
      decision
        .requiresDisambiguation ===
      holdoutCase
        .expectedDisambiguationRequired;

    const transformationMatches =
      decision
        .requiresTransformation ===
      holdoutCase
        .expectedTransformationRequired;

    if (decisionMatches) {
      exactDecisionMatchCount += 1;
    }

    if (
      dependencyKindMatches
    ) {
      dependencyKindMatchCount += 1;
    }

    if (selectionMatches) {
      selectionMatchCount += 1;
    }

    if (
      disambiguationMatches
    ) {
      disambiguationMatchCount += 1;
    }

    if (
      transformationMatches
    ) {
      transformationMatchCount += 1;
    }

    switch (decision.decision) {
      case "ACCEPT":
        predictedAcceptCount += 1;

        if (
          holdoutCase
            .expectedDecision ===
          "ACCEPT"
        ) {
          correctAcceptCount += 1;
        } else {
          unsupportedAcceptCount +=
            1;
        }

        break;

      case "REJECT":
        predictedRejectCount += 1;

        if (
          holdoutCase
            .expectedDecision ===
          "REJECT"
        ) {
          correctRejectCount += 1;
        } else {
          incorrectRejectCount += 1;
        }

        break;

      case "ABSTAIN":
        predictedAbstainCount += 1;

        if (
          holdoutCase
            .expectedDecision ===
          "ABSTAIN"
        ) {
          correctAbstainCount += 1;
        } else {
          incorrectAbstainCount +=
            1;
        }

        break;
    }

    caseResults.push({
      id: holdoutCase.id,
      candidateId:
        holdoutCase.candidateId,
      toolkit:
        holdoutCase.toolkit,
      status: "SCORED",
      expectedDecision:
        holdoutCase
          .expectedDecision,
      actualDecision:
        decision.decision,
      decisionMatches,
      expectedDependencyKind:
        holdoutCase
          .expectedDependencyKind,
      actualDependencyKind:
        decision.dependencyKind,
      dependencyKindMatches,
      selectionMatches,
      disambiguationMatches,
      transformationMatches,
    });
  }

  const totalCases =
    holdout.cases.length;

  return {
    format:
      "adjudication-holdout-score-v1",
    holdoutFormat:
      holdout.format,
    totalCases,
    validDecisionCount,
    coverage:
      ratio(
        validDecisionCount,
        totalCases,
      ),
    invalidResponseCount,
    transportFailureCount,
    dryRunResultCount,
    missingResultCount,
    decisions: {
      exactMatchCount:
        exactDecisionMatchCount,
      accuracy:
        ratio(
          exactDecisionMatchCount,
          totalCases,
        ),
      accept: {
        expectedCount:
          expectedAcceptCount,
        predictedCount:
          predictedAcceptCount,
        correctCount:
          correctAcceptCount,
        unsupportedAcceptCount,
        precision:
          ratio(
            correctAcceptCount,
            predictedAcceptCount,
          ),
        recall:
          ratio(
            correctAcceptCount,
            expectedAcceptCount,
          ),
      },
      reject: {
        expectedCount:
          expectedRejectCount,
        predictedCount:
          predictedRejectCount,
        correctCount:
          correctRejectCount,
        incorrectCount:
          incorrectRejectCount,
        accuracy:
          ratio(
            correctRejectCount,
            expectedRejectCount,
          ),
      },
      abstain: {
        expectedCount:
          expectedAbstainCount,
        predictedCount:
          predictedAbstainCount,
        correctCount:
          correctAbstainCount,
        incorrectCount:
          incorrectAbstainCount,
        recall:
          ratio(
            correctAbstainCount,
            expectedAbstainCount,
          ),
      },
    },
    dependencyKind: {
      evaluatedCount:
        validDecisionCount,
      matchCount:
        dependencyKindMatchCount,
      matchRate:
        ratio(
          dependencyKindMatchCount,
          validDecisionCount,
        ),
    },
    flags: {
      selection: {
        evaluatedCount:
          validDecisionCount,
        matchCount:
          selectionMatchCount,
        matchRate:
          ratio(
            selectionMatchCount,
            validDecisionCount,
          ),
      },
      disambiguation: {
        evaluatedCount:
          validDecisionCount,
        matchCount:
          disambiguationMatchCount,
        matchRate:
          ratio(
            disambiguationMatchCount,
            validDecisionCount,
          ),
      },
      transformation: {
        evaluatedCount:
          validDecisionCount,
        matchCount:
          transformationMatchCount,
        matchRate:
          ratio(
            transformationMatchCount,
            validDecisionCount,
          ),
      },
    },
    caseResults,
  };
}