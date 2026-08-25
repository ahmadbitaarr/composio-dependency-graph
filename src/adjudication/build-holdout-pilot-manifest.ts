import type {
  HoldoutEligibilityAudit,
} from "./analyze-holdout-eligibility";
import type {
  AdjudicationHoldoutFile,
} from "./score-holdout";

export type HoldoutPilotManifestCase = {
  holdoutCaseId: string;
  candidateId: string;
  toolkit:
    | "github"
    | "googlesuper";
  sourcePrimaryReason: string;
};

export type HoldoutPilotManifest = {
  format:
    "adjudication-holdout-pilot-manifest-v1";
  generatedFrom: {
    holdoutFormat:
      AdjudicationHoldoutFile[
        "format"
      ];
    eligibilityAuditFormat:
      HoldoutEligibilityAudit[
        "format"
      ];
  };
  selectionPolicy: {
    description: string;
    retainedEligibleOnly: true;
    expectedLabelsIncluded: false;
    rationalesIncluded: false;
  };
  summary: {
    totalSelected: number;
    github: number;
    googlesuper: number;
    primaryReasonCounts:
      Record<string, number>;
  };
  candidateIds: string[];
  cases:
    HoldoutPilotManifestCase[];
};

export function buildHoldoutPilotManifest(
  holdout:
    AdjudicationHoldoutFile,
  audit:
    HoldoutEligibilityAudit,
): HoldoutPilotManifest {
  if (
    holdout.format !==
    "adjudication-holdout-v1"
  ) {
    throw new Error(
      `Unsupported holdout format: ${holdout.format}`,
    );
  }

  if (
    audit.format !==
    "adjudication-holdout-eligibility-audit-v1"
  ) {
    throw new Error(
      `Unsupported audit format: ${audit.format}`,
    );
  }

  if (
    !audit.invariants
      .allCasesHaveAssessment ||
    !audit.invariants
      .retainedCasesAreEligible ||
    !audit.invariants
      .eligibleCasesAreRetained
  ) {
    throw new Error(
      "Holdout eligibility audit invariants must pass before building the pilot manifest.",
    );
  }

  const auditByCandidateId =
    new Map(
      audit.cases.map(
        (auditCase) => [
          auditCase.candidateId,
          auditCase,
        ],
      ),
    );

  const cases:
    HoldoutPilotManifestCase[] =
    [];

  for (
    const holdoutCase
    of holdout.cases
  ) {
    const auditCase =
      auditByCandidateId.get(
        holdoutCase.candidateId,
      );

    if (!auditCase) {
      throw new Error(
        `Missing audit case for holdout candidate: ${holdoutCase.candidateId}`,
      );
    }

    if (!auditCase.retained) {
      continue;
    }

    if (
      auditCase.category !==
      "ELIGIBLE"
    ) {
      throw new Error(
        `Retained candidate is not ELIGIBLE: ${holdoutCase.candidateId}`,
      );
    }

    cases.push({
      holdoutCaseId:
        holdoutCase.id,
      candidateId:
        holdoutCase.candidateId,
      toolkit:
        holdoutCase.toolkit,
      sourcePrimaryReason:
        holdoutCase
          .sourcePrimaryReason,
    });
  }

  if (
    cases.length !==
    audit.retainedEligibleCount
  ) {
    throw new Error(
      `Expected ${audit.retainedEligibleCount} retained cases, built ${cases.length}.`,
    );
  }

  const candidateIds =
    cases.map(
      (pilotCase) =>
        pilotCase.candidateId,
    );

  if (
    new Set(candidateIds).size !==
    candidateIds.length
  ) {
    throw new Error(
      "Pilot manifest contains duplicate candidate IDs.",
    );
  }

  const primaryReasonCounts:
    Record<string, number> = {};

  let github = 0;
  let googlesuper = 0;

  for (
    const pilotCase
    of cases
  ) {
    if (
      pilotCase.toolkit ===
      "github"
    ) {
      github += 1;
    } else {
      googlesuper += 1;
    }

    primaryReasonCounts[
      pilotCase.sourcePrimaryReason
    ] =
      (
        primaryReasonCounts[
          pilotCase
            .sourcePrimaryReason
        ] ?? 0
      ) + 1;
  }

  return {
    format:
      "adjudication-holdout-pilot-manifest-v1",
    generatedFrom: {
      holdoutFormat:
        holdout.format,
      eligibilityAuditFormat:
        audit.format,
    },
    selectionPolicy: {
      description:
        "Select every frozen holdout candidate retained as ELIGIBLE by the current eligibility report.",
      retainedEligibleOnly: true,
      expectedLabelsIncluded: false,
      rationalesIncluded: false,
    },
    summary: {
      totalSelected:
        cases.length,
      github,
      googlesuper,
      primaryReasonCounts,
    },
    candidateIds,
    cases,
  };
}