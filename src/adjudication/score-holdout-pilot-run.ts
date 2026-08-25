import type {
  HoldoutPilotManifest,
} from "./build-holdout-pilot-manifest";
import type {
  AdjudicationRunReport,
} from "./runner";
import {
  scoreAdjudicationHoldout,
  type AdjudicationHoldoutCase,
  type AdjudicationHoldoutFile,
  type AdjudicationHoldoutScore,
} from "./score-holdout";

export type HoldoutPilotScoreReport = {
  format:
    "adjudication-holdout-pilot-score-v1";
  source: {
    holdoutFormat:
      AdjudicationHoldoutFile[
        "format"
      ];
    manifestFormat:
      HoldoutPilotManifest[
        "format"
      ];
    runFormat:
      AdjudicationRunReport[
        "format"
      ];
    model: string;
    promptVersion: string;
  };
  selection: {
    totalSelected: number;
    github: number;
    googlesuper: number;
  };
  execution: {
    dryRun: boolean;
    requestLimit: number;
    requestCount: number;
    completedCount: number;
    cacheHitCount: number;
    failedCount: number;
    dryRunCount: number;
  };
  score:
    AdjudicationHoldoutScore;
  safetyGate: {
    fullCoverage: boolean;
    zeroUnsupportedAccepts:
      boolean;
    noInvalidResponses:
      boolean;
    noTransportFailures:
      boolean;
    noDryRunResults: boolean;
    noMissingResults: boolean;
    passed: boolean;
  };
};

function sameStringArray(
  left: string[],
  right: string[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value === right[index],
    )
  );
}

function validateInputs(
  holdout:
    AdjudicationHoldoutFile,
  manifest:
    HoldoutPilotManifest,
  run: AdjudicationRunReport,
): void {
  if (
    holdout.format !==
    "adjudication-holdout-v1"
  ) {
    throw new Error(
      `Unsupported holdout format: ${holdout.format}`,
    );
  }

  if (
    manifest.format !==
    "adjudication-holdout-pilot-manifest-v1"
  ) {
    throw new Error(
      `Unsupported manifest format: ${manifest.format}`,
    );
  }

  if (
    run.format !==
    "adjudication-run-report-v1"
  ) {
    throw new Error(
      `Unsupported run format: ${run.format}`,
    );
  }

  if (
    manifest.selectionPolicy
      .expectedLabelsIncluded ||
    manifest.selectionPolicy
      .rationalesIncluded
  ) {
    throw new Error(
      "Pilot manifest must not include expected labels or rationales.",
    );
  }

  if (
    !sameStringArray(
      manifest.candidateIds,
      run.selectedCandidateIds,
    )
  ) {
    throw new Error(
      "Pilot run candidate selection does not match the frozen manifest.",
    );
  }
}

function selectedHoldoutCases(
  holdout:
    AdjudicationHoldoutFile,
  manifest:
    HoldoutPilotManifest,
): AdjudicationHoldoutCase[] {
  const byCandidateId =
    new Map(
      holdout.cases.map(
        (holdoutCase) => [
          holdoutCase.candidateId,
          holdoutCase,
        ],
      ),
    );

  return manifest.candidateIds.map(
    (candidateId) => {
      const holdoutCase =
        byCandidateId.get(
          candidateId,
        );

      if (!holdoutCase) {
        throw new Error(
          `Manifest candidate is missing from the frozen holdout: ${candidateId}`,
        );
      }

      return holdoutCase;
    },
  );
}

export function scoreHoldoutPilotRun(
  holdout:
    AdjudicationHoldoutFile,
  manifest:
    HoldoutPilotManifest,
  run: AdjudicationRunReport,
): HoldoutPilotScoreReport {
  validateInputs(
    holdout,
    manifest,
    run,
  );

  const cases =
    selectedHoldoutCases(
      holdout,
      manifest,
    );

  if (
    cases.length !==
    manifest.summary.totalSelected
  ) {
    throw new Error(
      "Selected holdout case count does not match the manifest summary.",
    );
  }

  const selectedHoldout:
    AdjudicationHoldoutFile = {
    ...holdout,
    cases,
  };

  const score =
    scoreAdjudicationHoldout(
      selectedHoldout,
      run.results,
    );

  const fullCoverage =
    score.validDecisionCount ===
    manifest.summary.totalSelected;

  const zeroUnsupportedAccepts =
    score.decisions.accept
      .unsupportedAcceptCount === 0;

  const noInvalidResponses =
    score.invalidResponseCount ===
    0;

  const noTransportFailures =
    score.transportFailureCount ===
    0;

  const noDryRunResults =
    score.dryRunResultCount === 0;

  const noMissingResults =
    score.missingResultCount === 0;

  return {
    format:
      "adjudication-holdout-pilot-score-v1",
    source: {
      holdoutFormat:
        holdout.format,
      manifestFormat:
        manifest.format,
      runFormat: run.format,
      model: run.model,
      promptVersion:
        run.promptVersion,
    },
    selection: {
      totalSelected:
        manifest.summary
          .totalSelected,
      github:
        manifest.summary.github,
      googlesuper:
        manifest.summary
          .googlesuper,
    },
    execution: {
      dryRun: run.dryRun,
      requestLimit:
        run.requestLimit,
      requestCount:
        run.requestCount,
      completedCount:
        run.summary
          .completedCount,
      cacheHitCount:
        run.summary
          .cacheHitCount,
      failedCount:
        run.summary.failedCount,
      dryRunCount:
        run.summary.dryRunCount,
    },
    score,
    safetyGate: {
      fullCoverage,
      zeroUnsupportedAccepts,
      noInvalidResponses,
      noTransportFailures,
      noDryRunResults,
      noMissingResults,
      passed:
        fullCoverage &&
        zeroUnsupportedAccepts &&
        noInvalidResponses &&
        noTransportFailures &&
        noDryRunResults &&
        noMissingResults,
    },
  };
}