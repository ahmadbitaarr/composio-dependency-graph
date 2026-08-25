import type {
  EligibilityReportFile,
} from "./request-builder";
import type {
  AdjudicationHoldoutFile,
} from "./score-holdout";

export type HoldoutEligibilityAuditCase = {
  id: string;
  candidateId: string;
  toolkit:
    | "github"
    | "googlesuper";
  retained: boolean;
  category: string;
  reasonCodes: string[];
  explanation: string | null;
};

export type HoldoutEligibilityAudit = {
  format:
    "adjudication-holdout-eligibility-audit-v1";
  holdoutFormat:
    AdjudicationHoldoutFile[
      "format"
    ];
  eligibilityFormat:
    EligibilityReportFile[
      "format"
    ];
  totalCases: number;
  retainedEligibleCount: number;
  notRetainedCount: number;
  missingAssessmentCount: number;
  categoryCounts:
    Record<string, number>;
  invariants: {
    allCasesHaveAssessment:
      boolean;
    retainedCasesAreEligible:
      boolean;
    eligibleCasesAreRetained:
      boolean;
  };
  cases:
    HoldoutEligibilityAuditCase[];
};

export function analyzeHoldoutEligibility(
  holdout:
    AdjudicationHoldoutFile,
  eligibility:
    EligibilityReportFile,
): HoldoutEligibilityAudit {
  if (
    holdout.format !==
    "adjudication-holdout-v1"
  ) {
    throw new Error(
      `Unsupported holdout format: ${holdout.format}`,
    );
  }

  if (
    eligibility.format !==
    "adjudication-eligibility-report-v1"
  ) {
    throw new Error(
      `Unsupported eligibility format: ${eligibility.format}`,
    );
  }

  const retainedCandidateIds =
    new Set(
      eligibility
        .retainedCandidateIds,
    );

  const assessmentByCandidateId =
    new Map(
      eligibility.assessments.map(
        (assessment) => [
          assessment.candidateId,
          assessment,
        ],
      ),
    );

  const categoryCounts:
    Record<string, number> = {};

  let retainedEligibleCount = 0;
  let missingAssessmentCount = 0;

  let retainedCasesAreEligible =
    true;

  let eligibleCasesAreRetained =
    true;

  const cases =
    holdout.cases.map(
      (
        holdoutCase,
      ): HoldoutEligibilityAuditCase => {
        const assessment =
          assessmentByCandidateId.get(
            holdoutCase.candidateId,
          );

        const retained =
          retainedCandidateIds.has(
            holdoutCase.candidateId,
          );

        const category =
          assessment?.category ??
          "MISSING_ASSESSMENT";

        categoryCounts[category] =
          (
            categoryCounts[
              category
            ] ?? 0
          ) + 1;

        if (!assessment) {
          missingAssessmentCount +=
            1;
        }

        if (retained) {
          retainedEligibleCount +=
            1;

          if (
            category !==
            "ELIGIBLE"
          ) {
            retainedCasesAreEligible =
              false;
          }
        }

        if (
          category ===
            "ELIGIBLE" &&
          !retained
        ) {
          eligibleCasesAreRetained =
            false;
        }

        return {
          id: holdoutCase.id,
          candidateId:
            holdoutCase.candidateId,
          toolkit:
            holdoutCase.toolkit,
          retained,
          category,
          reasonCodes:
            assessment
              ? [
                  ...assessment
                    .reasonCodes,
                ]
              : [],
          explanation:
            assessment
              ?.explanation ??
            null,
        };
      },
    );

  return {
    format:
      "adjudication-holdout-eligibility-audit-v1",
    holdoutFormat:
      holdout.format,
    eligibilityFormat:
      eligibility.format,
    totalCases:
      holdout.cases.length,
    retainedEligibleCount,
    notRetainedCount:
      holdout.cases.length -
      retainedEligibleCount,
    missingAssessmentCount,
    categoryCounts,
    invariants: {
      allCasesHaveAssessment:
        missingAssessmentCount ===
        0,
      retainedCasesAreEligible,
      eligibleCasesAreRetained,
    },
    cases,
  };
}