import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  rm,
} from "node:fs/promises";

import type {
  DecisionArtifact,
} from "../src/matching";
import type {
  NormalizedToolCatalog,
} from "../src/types";
import {
  InMemoryAdjudicationCache,
} from "../src/adjudication/cache";
import {
  OpenRouterTransportError,
  type AdjudicationTransport,
} from "../src/adjudication/client";
import {
  buildAdjudicationRequest,
  type EligibilityReportFile,
} from "../src/adjudication/request-builder";
import {
  MAX_SAFE_PILOT_CANDIDATES,
  runAdjudicationBatch,
  selectAdjudicationCandidateIds,
  type AdjudicationRunReport,
} from "../src/adjudication/runner";
import type {
  AdjudicationDecision,
} from "../src/adjudication/schema";

const uncertain =
  (await Bun.file(
    "data/candidates.uncertain.json",
  ).json()) as DecisionArtifact;

const catalog =
  (await Bun.file(
    "data/normalized-tools.json",
  ).json()) as NormalizedToolCatalog;

const eligibility =
  (await Bun.file(
    "data/adjudication/eligibility-report.json",
  ).json()) as EligibilityReportFile;

const selectedCandidateIds =
  eligibility
    .retainedCandidateIds
    .slice(0, 2);

if (
  selectedCandidateIds.length <
  2
) {
  throw new Error(
    "Expected at least two retained candidates.",
  );
}

const model =
  "test/mock-model";

function tempReportPath(
  label: string,
): string {
  return [
    "data/adjudication/",
    `test-run-${label}-`,
    Date.now(),
    "-",
    Math.random(),
    ".json",
  ].join("");
}

function decisionFor(
  candidateId: string,
): AdjudicationDecision {
  const request =
    buildAdjudicationRequest(
      candidateId,
      uncertain,
      eligibility,
      catalog,
    );

  const requiresTransformation =
    request
      .deterministicAnalysis
      .transformationRequired;

  return {
    candidateId,
    decision: "ABSTAIN",
    dependencyKind:
      requiresTransformation
        ? "TRANSFORMATION"
        : "UNKNOWN",
    requiresSelection:
      request
        .deterministicAnalysis
        .selectionRequired,
    requiresDisambiguation:
      request
        .deterministicAnalysis
        .disambiguationRequired,
    requiresTransformation,
    evidenceReferences: [
      "candidate.primaryReason",
    ],
    reasonCodes: [
      "INSUFFICIENT_EVIDENCE",
    ],
    explanation:
      "The supplied evidence does not fully resolve the dependency.",
  };
}

function responseFor(
  candidateId: string,
): string {
  return JSON.stringify(
    decisionFor(candidateId),
  );
}

async function readReport(
  path: string,
): Promise<
  AdjudicationRunReport
> {
  return (
    await Bun.file(
      path,
    ).json()
  ) as AdjudicationRunReport;
}

describe(
  "adjudication batch runner",
  () => {
    test(
      "requires an explicit limited candidate selection",
      () => {
        expect(() =>
          selectAdjudicationCandidateIds(
            eligibility,
            {},
          ),
        ).toThrow(
          "candidateLimit is required",
        );

        expect(() =>
          selectAdjudicationCandidateIds(
            eligibility,
            {
              candidateLimit:
                MAX_SAFE_PILOT_CANDIDATES +
                1,
            },
          ),
        ).toThrow(
          `candidateLimit cannot exceed ${MAX_SAFE_PILOT_CANDIDATES}`,
        );
      },
    );

    test(
      "dry-run persists previews and makes zero transport requests",
      async () => {
        const reportPath =
          tempReportPath(
            "dry-run",
          );

        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              throw new Error(
                "Dry-run must not call transport.",
              );
            },
          };

        try {
          const report =
            await runAdjudicationBatch({
              uncertain,
              eligibility,
              catalog,
              model,
              transport,
              cache:
                new InMemoryAdjudicationCache(),
              reportPath,
              candidateIds:
                selectedCandidateIds,
              dryRun: true,
            });

          expect(
            report.stopReason,
          ).toBe("COMPLETED");

          expect(
            report.requestCount,
          ).toBe(0);

          expect(calls).toBe(0);

          expect(
            report.summary
              .dryRunCount,
          ).toBe(2);

          const persisted =
            await readReport(
              reportPath,
            );

          expect(
            persisted.summary
              .terminalResultCount,
          ).toBe(2);
        } finally {
          await rm(
            reportPath,
            {
              force: true,
            },
          );
        }
      },
    );

    test(
      "stops at the exact request limit",
      async () => {
        const reportPath =
          tempReportPath(
            "limit",
          );

        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              const candidateId =
                selectedCandidateIds[
                  calls
                ];

              calls += 1;

              if (!candidateId) {
                throw new Error(
                  "Unexpected extra transport call.",
                );
              }

              return {
                content:
                  responseFor(
                    candidateId,
                  ),
                requestId: null,
              };
            },
          };

        try {
          const report =
            await runAdjudicationBatch({
              uncertain,
              eligibility,
              catalog,
              model,
              transport,
              cache:
                new InMemoryAdjudicationCache(),
              reportPath,
              candidateIds:
                selectedCandidateIds,
              requestLimit: 1,
            });

          expect(calls).toBe(1);

          expect(
            report.requestCount,
          ).toBe(1);

          expect(
            report.stopReason,
          ).toBe(
            "REQUEST_LIMIT_REACHED",
          );

          expect(
            report.summary
              .terminalResultCount,
          ).toBe(1);
        } finally {
          await rm(
            reportPath,
            {
              force: true,
            },
          );
        }
      },
    );

    test(
      "resumes an existing report without repeating finished candidates",
      async () => {
        const reportPath =
          tempReportPath(
            "resume",
          );

        const cache =
          new InMemoryAdjudicationCache();

        let firstCalls = 0;

        const firstTransport:
          AdjudicationTransport = {
            async complete() {
              firstCalls += 1;

              return {
                content:
                  responseFor(
                    selectedCandidateIds[
                      0
                    ]!,
                  ),
                requestId: null,
              };
            },
          };

        let secondCalls = 0;

        const secondTransport:
          AdjudicationTransport = {
            async complete() {
              secondCalls += 1;

              return {
                content:
                  responseFor(
                    selectedCandidateIds[
                      1
                    ]!,
                  ),
                requestId: null,
              };
            },
          };

        try {
          const first =
            await runAdjudicationBatch({
              uncertain,
              eligibility,
              catalog,
              model,
              transport:
                firstTransport,
              cache,
              reportPath,
              candidateIds:
                selectedCandidateIds,
              requestLimit: 1,
            });

          expect(
            first.stopReason,
          ).toBe(
            "REQUEST_LIMIT_REACHED",
          );

          const resumed =
            await runAdjudicationBatch({
              uncertain,
              eligibility,
              catalog,
              model,
              transport:
                secondTransport,
              cache,
              reportPath,
              candidateIds:
                selectedCandidateIds,
              requestLimit: 2,
            });

          expect(firstCalls).toBe(
            1,
          );

          expect(secondCalls).toBe(
            1,
          );

          expect(
            resumed.stopReason,
          ).toBe("COMPLETED");

          expect(
            resumed.requestCount,
          ).toBe(2);

          expect(
            resumed.summary
              .terminalResultCount,
          ).toBe(2);

          expect(
            resumed.summary
              .resumedResultCount,
          ).toBe(1);
        } finally {
          await rm(
            reportPath,
            {
              force: true,
            },
          );
        }
      },
    );

    test(
      "persists a retry-exhausted failure without exceeding the request budget",
      async () => {
        const reportPath =
          tempReportPath(
            "failure",
          );

        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              throw new OpenRouterTransportError(
                "Temporary failure.",
                {
                  retryable: true,
                  statusCode: 503,
                },
              );
            },
          };

        try {
          const report =
            await runAdjudicationBatch({
              uncertain,
              eligibility,
              catalog,
              model,
              transport,
              cache:
                new InMemoryAdjudicationCache(),
              reportPath,
              candidateIds: [
                selectedCandidateIds[
                  0
                ]!,
              ],
              requestLimit: 2,
              maxAttemptsPerCandidate:
                3,
              retryDelayMs: 0,
              sleep: async () => {},
            });

          expect(calls).toBe(2);

          expect(
            report.requestCount,
          ).toBe(2);

          expect(
            report.summary
              .failedCount,
          ).toBe(1);

          const persisted =
            await readReport(
              reportPath,
            );

          const result =
            persisted.results[
              selectedCandidateIds[
                0
              ]!
            ];

          expect(
            result?.status,
          ).toBe("FAILED");

          if (
            result?.status ===
            "FAILED"
          ) {
            expect(
              result.attempts,
            ).toBe(2);

            expect(
              result.failure.code,
            ).toBe(
              "TRANSPORT_FAILURE",
            );
          }
        } finally {
          await rm(
            reportPath,
            {
              force: true,
            },
          );
        }
      },
    );
  },
);