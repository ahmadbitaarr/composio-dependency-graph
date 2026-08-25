import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  HoldoutPilotManifest,
} from "../src/adjudication/build-holdout-pilot-manifest";
import type {
  AdjudicationExecutionResult,
} from "../src/adjudication/client";
import {
  ADJUDICATION_PROMPT_VERSION,
} from "../src/adjudication/request-builder";
import type {
  AdjudicationRunReport,
} from "../src/adjudication/runner";
import {
  scoreHoldoutPilotRun,
} from "../src/adjudication/score-holdout-pilot-run";
import type {
  AdjudicationHoldoutCase,
  AdjudicationHoldoutFile,
} from "../src/adjudication/score-holdout";
import type {
  AdjudicationDecision,
} from "../src/adjudication/schema";

const holdout =
  (await Bun.file(
    "tests/fixtures/adjudication-holdout.json",
  ).json()) as AdjudicationHoldoutFile;

const manifest =
  (await Bun.file(
    "data/adjudication/holdout-pilot-manifest.json",
  ).json()) as HoldoutPilotManifest;

const holdoutByCandidateId =
  new Map(
    holdout.cases.map(
      (holdoutCase) => [
        holdoutCase.candidateId,
        holdoutCase,
      ],
    ),
  );

function holdoutCaseFor(
  candidateId: string,
): AdjudicationHoldoutCase {
  const holdoutCase =
    holdoutByCandidateId.get(
      candidateId,
    );

  if (!holdoutCase) {
    throw new Error(
      `Missing holdout case: ${candidateId}`,
    );
  }

  return holdoutCase;
}

function completedResult(
  holdoutCase:
    AdjudicationHoldoutCase,
  overrides:
    Partial<
      AdjudicationDecision
    > = {},
): AdjudicationExecutionResult {
  const decision:
    AdjudicationDecision = {
    candidateId:
      holdoutCase.candidateId,
    decision:
      holdoutCase
        .expectedDecision,
    dependencyKind:
      holdoutCase
        .expectedDependencyKind,
    requiresSelection:
      holdoutCase
        .expectedSelectionRequired,
    requiresDisambiguation:
      holdoutCase
        .expectedDisambiguationRequired,
    requiresTransformation:
      holdoutCase
        .expectedTransformationRequired,
    evidenceReferences: [
      "candidate.primaryReason",
    ],
    reasonCodes: [
      "TEST_RESULT",
    ],
    explanation:
      "Mocked result.",
    ...overrides,
  };

  return {
    status: "COMPLETED",
    candidateId:
      holdoutCase.candidateId,
    model: "test/mock-model",
    cacheKey:
      `cache-${holdoutCase.id}`,
    requestHash:
      `request-${holdoutCase.id}`,
    attempts: 1,
    llmRequestsMade: true,
    record: {
      format:
        "adjudication-cache-record-v1",
      key:
        `cache-${holdoutCase.id}`,
      requestHash:
        `request-${holdoutCase.id}`,
      candidateId:
        holdoutCase.candidateId,
      model:
        "test/mock-model",
      promptVersion:
        ADJUDICATION_PROMPT_VERSION,
      rawResponse:
        JSON.stringify(decision),
      decision,
      createdAt:
        "2026-07-21T00:00:00.000Z",
    },
  };
}

function runReport(
  results: Record<
    string,
    AdjudicationExecutionResult
  >,
  options: {
    dryRun?: boolean;
    requestCount?: number;
  } = {},
): AdjudicationRunReport {
  const values =
    Object.values(results);

  const completedCount =
    values.filter(
      (result) =>
        result.status ===
        "COMPLETED",
    ).length;

  const cacheHitCount =
    values.filter(
      (result) =>
        result.status ===
        "CACHE_HIT",
    ).length;

  const failedCount =
    values.filter(
      (result) =>
        result.status ===
        "FAILED",
    ).length;

  const dryRunCount =
    values.filter(
      (result) =>
        result.status ===
        "DRY_RUN",
    ).length;

  return {
    format:
      "adjudication-run-report-v1",
    model: "test/mock-model",
    promptVersion:
      ADJUDICATION_PROMPT_VERSION,
    dryRun:
      options.dryRun ?? false,
    requestLimit:
      options.requestCount ?? 22,
    maxAttemptsPerCandidate: 2,
    selectedCandidateIds: [
      ...manifest.candidateIds,
    ],
    startedAt:
      "2026-07-21T00:00:00.000Z",
    updatedAt:
      "2026-07-21T00:01:00.000Z",
    completedAt:
      "2026-07-21T00:01:00.000Z",
    stopReason: "COMPLETED",
    requestCount:
      options.requestCount ?? 22,
    results,
    summary: {
      selectedCandidateCount:
        manifest.candidateIds
          .length,
      terminalResultCount:
        values.length,
      completedCount,
      cacheHitCount,
      dryRunCount,
      failedCount,
      requestCount:
        options.requestCount ?? 22,
      resumedResultCount: 0,
    },
  };
}

describe(
  "holdout pilot run scoring",
  () => {
    test(
      "passes the safety gate for perfect complete results",
      () => {
        const results:
          Record<
            string,
            AdjudicationExecutionResult
          > = {};

        for (
          const candidateId
          of manifest.candidateIds
        ) {
          const holdoutCase =
            holdoutCaseFor(
              candidateId,
            );

          results[candidateId] =
            completedResult(
              holdoutCase,
            );
        }

        const report =
          scoreHoldoutPilotRun(
            holdout,
            manifest,
            runReport(results),
          );

        expect(
          report.score
            .validDecisionCount,
        ).toBe(22);

        expect(
          report.score.decisions
            .exactMatchCount,
        ).toBe(22);

        expect(
          report.score.decisions
            .accept
            .unsupportedAcceptCount,
        ).toBe(0);

        expect(
          report.safetyGate
            .passed,
        ).toBe(true);
      },
    );

    test(
      "fails the safety gate for dry-run results",
      () => {
        const results:
          Record<
            string,
            AdjudicationExecutionResult
          > = {};

        for (
          const candidateId
          of manifest.candidateIds
        ) {
          results[candidateId] = {
            status: "DRY_RUN",
            candidateId,
            model:
              "test/mock-model",
            cacheKey:
              `cache-${candidateId}`,
            requestHash:
              `request-${candidateId}`,
            attempts: 0,
            llmRequestsMade:
              false,
          };
        }

        const report =
          scoreHoldoutPilotRun(
            holdout,
            manifest,
            runReport(
              results,
              {
                dryRun: true,
                requestCount: 0,
              },
            ),
          );

        expect(
          report.score
            .validDecisionCount,
        ).toBe(0);

        expect(
          report.score
            .dryRunResultCount,
        ).toBe(22);

        expect(
          report.safetyGate
            .noDryRunResults,
        ).toBe(false);

        expect(
          report.safetyGate
            .passed,
        ).toBe(false);
      },
    );

    test(
      "fails the safety gate for an unsupported ACCEPT",
      () => {
        const results:
          Record<
            string,
            AdjudicationExecutionResult
          > = {};

        for (
          const candidateId
          of manifest.candidateIds
        ) {
          const holdoutCase =
            holdoutCaseFor(
              candidateId,
            );

          results[candidateId] =
            completedResult(
              holdoutCase,
            );
        }

        const nonAcceptCase =
          manifest.candidateIds
            .map(
              holdoutCaseFor,
            )
            .find(
              (holdoutCase) =>
                holdoutCase
                  .expectedDecision !==
                "ACCEPT",
            );

        if (!nonAcceptCase) {
          throw new Error(
            "Expected a non-ACCEPT holdout case.",
          );
        }

        results[
          nonAcceptCase.candidateId
        ] =
          completedResult(
            nonAcceptCase,
            {
              decision: "ACCEPT",
              dependencyKind:
                "LOOKUP",
            },
          );

        const report =
          scoreHoldoutPilotRun(
            holdout,
            manifest,
            runReport(results),
          );

        expect(
          report.score.decisions
            .accept
            .unsupportedAcceptCount,
        ).toBe(1);

        expect(
          report.safetyGate
            .zeroUnsupportedAccepts,
        ).toBe(false);

        expect(
          report.safetyGate
            .passed,
        ).toBe(false);
      },
    );

    test(
      "rejects a run using a different candidate selection",
      () => {
        const run =
          runReport({});

        run.selectedCandidateIds =
          run.selectedCandidateIds
            .slice(1);

        expect(() =>
          scoreHoldoutPilotRun(
            holdout,
            manifest,
            run,
          ),
        ).toThrow(
          "Pilot run candidate selection does not match the frozen manifest.",
        );
      },
    );
  },
);