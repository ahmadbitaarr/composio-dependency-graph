import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  AdjudicationExecutionResult,
} from "../src/adjudication/client";
import {
  scoreAdjudicationHoldout,
  type AdjudicationHoldoutCase,
  type AdjudicationHoldoutFile,
} from "../src/adjudication/score-holdout";
import type {
  AdjudicationDecision,
} from "../src/adjudication/schema";

const holdout =
  (await Bun.file(
    "tests/fixtures/adjudication-holdout.json",
  ).json()) as AdjudicationHoldoutFile;

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
      "Mocked evidence-bound result.",
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
        "dependency-adjudication-v1",
      rawResponse:
        JSON.stringify(decision),
      decision,
      createdAt:
        "2026-07-21T00:00:00.000Z",
    },
  };
}

function subsetHoldout(
  ids: string[],
): AdjudicationHoldoutFile {
  const cases =
    ids.map((id) => {
      const holdoutCase =
        holdout.cases.find(
          (item) =>
            item.id === id,
        );

      if (!holdoutCase) {
        throw new Error(
          `Holdout case not found: ${id}`,
        );
      }

      return holdoutCase;
    });

  return {
    ...holdout,
    cases,
  };
}

describe(
  "adjudication holdout scoring",
  () => {
    test(
      "scores exact frozen labels perfectly",
      () => {
        const results:
          Record<
            string,
            AdjudicationExecutionResult
          > = {};

        for (
          const holdoutCase
          of holdout.cases
        ) {
          results[
            holdoutCase.candidateId
          ] =
            completedResult(
              holdoutCase,
            );
        }

        const score =
          scoreAdjudicationHoldout(
            holdout,
            results,
          );

        expect(
          score.totalCases,
        ).toBe(40);

        expect(
          score.validDecisionCount,
        ).toBe(40);

        expect(
          score.decisions
            .exactMatchCount,
        ).toBe(40);

        expect(
          score.decisions
            .accuracy.rate,
        ).toBe(1);

        expect(
          score.decisions.accept
            .unsupportedAcceptCount,
        ).toBe(0);

        expect(
          score.decisions.accept
            .precision.rate,
        ).toBe(1);

        expect(
          score.dependencyKind
            .matchRate.rate,
        ).toBe(1);

        expect(
          score.flags.selection
            .matchRate.rate,
        ).toBe(1);

        expect(
          score.flags
            .disambiguation
            .matchRate.rate,
        ).toBe(1);

        expect(
          score.flags
            .transformation
            .matchRate.rate,
        ).toBe(1);

        expect(
          score.invalidResponseCount,
        ).toBe(0);

        expect(
          score.missingResultCount,
        ).toBe(0);
      },
    );

    test(
      "prioritizes unsupported ACCEPT errors",
      () => {
        const selected =
          subsetHoldout([
            "H01",
            "H02",
            "H20",
            "H21",
          ]);

        const h01 =
          selected.cases[0]!;

        const h02 =
          selected.cases[1]!;

        const h20 =
          selected.cases[2]!;

        const h21 =
          selected.cases[3]!;

        const results:
          Record<
            string,
            AdjudicationExecutionResult
          > = {
          [h01.candidateId]:
            completedResult(h01),

          [h02.candidateId]:
            completedResult(h02),

          [h20.candidateId]:
            completedResult(
              h20,
              {
                decision:
                  "ACCEPT",
                dependencyKind:
                  "LOOKUP",
              },
            ),

          [h21.candidateId]: {
            status: "FAILED",
            candidateId:
              h21.candidateId,
            model:
              "test/mock-model",
            cacheKey:
              "cache-invalid",
            requestHash:
              "request-invalid",
            attempts: 1,
            llmRequestsMade:
              true,
            failure: {
              code:
                "INVALID_MODEL_RESPONSE",
              message:
                "Invalid response.",
              retryable: false,
            },
            validation: null,
          },
        };

        const score =
          scoreAdjudicationHoldout(
            selected,
            results,
          );

        expect(
          score.totalCases,
        ).toBe(4);

        expect(
          score.validDecisionCount,
        ).toBe(3);

        expect(
          score.invalidResponseCount,
        ).toBe(1);

        expect(
          score.decisions
            .exactMatchCount,
        ).toBe(2);

        expect(
          score.decisions
            .accuracy.rate,
        ).toBe(0.5);

        expect(
          score.decisions.accept
            .predictedCount,
        ).toBe(2);

        expect(
          score.decisions.accept
            .correctCount,
        ).toBe(1);

        expect(
          score.decisions.accept
            .unsupportedAcceptCount,
        ).toBe(1);

        expect(
          score.decisions.accept
            .precision.rate,
        ).toBe(0.5);

        expect(
          score.decisions.reject
            .correctCount,
        ).toBe(0);

        expect(
          score.decisions.abstain
            .correctCount,
        ).toBe(1);
      },
    );

    test(
      "tracks missing, dry-run, and transport failures separately",
      () => {
        const selected =
          subsetHoldout([
            "H01",
            "H02",
            "H20",
          ]);

        const h01 =
          selected.cases[0]!;

        const h02 =
          selected.cases[1]!;

        const results:
          Record<
            string,
            AdjudicationExecutionResult
          > = {
          [h01.candidateId]: {
            status: "DRY_RUN",
            candidateId:
              h01.candidateId,
            model:
              "test/mock-model",
            cacheKey:
              "cache-dry-run",
            requestHash:
              "request-dry-run",
            attempts: 0,
            llmRequestsMade:
              false,
          },

          [h02.candidateId]: {
            status: "FAILED",
            candidateId:
              h02.candidateId,
            model:
              "test/mock-model",
            cacheKey:
              "cache-failed",
            requestHash:
              "request-failed",
            attempts: 2,
            llmRequestsMade:
              true,
            failure: {
              code:
                "TRANSPORT_FAILURE",
              message:
                "Transport failed.",
              retryable: true,
            },
            validation: null,
          },
        };

        const score =
          scoreAdjudicationHoldout(
            selected,
            results,
          );

        expect(
          score.validDecisionCount,
        ).toBe(0);

        expect(
          score.dryRunResultCount,
        ).toBe(1);

        expect(
          score.transportFailureCount,
        ).toBe(1);

        expect(
          score.missingResultCount,
        ).toBe(1);

        expect(
          score.coverage.rate,
        ).toBe(0);
      },
    );

    test(
      "rejects duplicate holdout candidate IDs",
      () => {
        const duplicate:
          AdjudicationHoldoutFile = {
          ...holdout,
          cases: [
            holdout.cases[0]!,
            holdout.cases[0]!,
          ],
        };

        expect(() =>
          scoreAdjudicationHoldout(
            duplicate,
            {},
          ),
        ).toThrow(
          "Holdout contains duplicate candidate IDs",
        );
      },
    );
  },
);