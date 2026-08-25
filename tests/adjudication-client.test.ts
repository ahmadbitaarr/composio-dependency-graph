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
  buildAdjudicationCacheIdentity,
  InMemoryAdjudicationCache,
  JsonFileAdjudicationCache,
  type AdjudicationCacheRecord,
} from "../src/adjudication/cache";
import {
  OpenRouterTransportError,
  runAdjudication,
  type AdjudicationTransport,
} from "../src/adjudication/client";
import {
  buildAdjudicationRequest,
  type EligibilityReportFile,
} from "../src/adjudication/request-builder";
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

const candidateId =
  eligibility.retainedCandidateIds[0];

if (!candidateId) {
  throw new Error(
    "Eligibility report contains no retained candidate.",
  );
}

const request =
  buildAdjudicationRequest(
    candidateId,
    uncertain,
    eligibility,
    catalog,
  );

const model =
  "test/mock-model";

function abstainDecision():
  AdjudicationDecision {
  return {
    candidateId:
      request.candidateId,
    decision: "ABSTAIN",
    dependencyKind: "UNKNOWN",
    requiresSelection:
      request
        .deterministicAnalysis
        .selectionRequired,
    requiresDisambiguation:
      request
        .deterministicAnalysis
        .disambiguationRequired,
    requiresTransformation:
      request
        .deterministicAnalysis
        .transformationRequired,
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

function validResponse():
  string {
  return JSON.stringify(
    abstainDecision(),
  );
}

describe(
  "adjudication client and cache",
  () => {
    test(
      "builds deterministic cache identities",
      () => {
        const input = {
          candidateId:
            "candidate-1",
          candidateContent: {
            producer: "a",
            consumer: "b",
          },
          prompt: "prompt",
          promptVersion: "v1",
          model: "model-a",
        };

        const first =
          buildAdjudicationCacheIdentity(
            input,
          );

        const second =
          buildAdjudicationCacheIdentity(
            input,
          );

        expect(first).toEqual(
          second,
        );
      },
    );

    test(
      "invalidates cache identity when model or prompt version changes",
      () => {
        const base = {
          candidateId:
            "candidate-1",
          candidateContent: {
            producer: "a",
          },
          prompt: "prompt",
          promptVersion: "v1",
          model: "model-a",
        };

        const initial =
          buildAdjudicationCacheIdentity(
            base,
          );

        const changedModel =
          buildAdjudicationCacheIdentity({
            ...base,
            model: "model-b",
          });

        const changedVersion =
          buildAdjudicationCacheIdentity({
            ...base,
            promptVersion: "v2",
          });

        expect(
          changedModel.key,
        ).not.toBe(initial.key);

        expect(
          changedVersion.key,
        ).not.toBe(initial.key);
      },
    );

    test(
      "dry-run makes no transport call and writes no cache record",
      async () => {
        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              throw new Error(
                "Transport should not run.",
              );
            },
          };

        const cache =
          new InMemoryAdjudicationCache();

        const result =
          await runAdjudication({
            request,
            model,
            transport,
            cache,
            dryRun: true,
          });

        expect(result.status).toBe(
          "DRY_RUN",
        );

        expect(calls).toBe(0);

        expect(
          result.llmRequestsMade,
        ).toBe(false);

        expect(
          await cache.get(
            result.cacheKey,
          ),
        ).toBeNull();
      },
    );

    test(
      "valid ABSTAIN is not retried",
      async () => {
        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              return {
                content:
                  validResponse(),
                requestId:
                  "mock-request",
              };
            },
          };

        const result =
          await runAdjudication({
            request,
            model,
            transport,
            cache:
              new InMemoryAdjudicationCache(),
            maxAttempts: 3,
            sleep: async () => {},
          });

        expect(result.status).toBe(
          "COMPLETED",
        );

        expect(calls).toBe(1);

        expect(result.attempts).toBe(
          1,
        );

        if (
          result.status ===
          "COMPLETED"
        ) {
          expect(
            result.record
              .decision.decision,
          ).toBe("ABSTAIN");
        }
      },
    );

    test(
      "uses a cached result without calling transport again",
      async () => {
        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              return {
                content:
                  validResponse(),
                requestId: null,
              };
            },
          };

        const cache =
          new InMemoryAdjudicationCache();

        const first =
          await runAdjudication({
            request,
            model,
            transport,
            cache,
          });

        const second =
          await runAdjudication({
            request,
            model,
            transport,
            cache,
          });

        expect(first.status).toBe(
          "COMPLETED",
        );

        expect(second.status).toBe(
          "CACHE_HIT",
        );

        expect(calls).toBe(1);

        expect(
          second.llmRequestsMade,
        ).toBe(false);
      },
    );

    test(
      "retries a retryable transport failure",
      async () => {
        let calls = 0;
        const delays: number[] =
          [];

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              if (calls === 1) {
                throw new OpenRouterTransportError(
                  "Temporary failure.",
                  {
                    retryable: true,
                    statusCode: 503,
                  },
                );
              }

              return {
                content:
                  validResponse(),
                requestId: null,
              };
            },
          };

        const result =
          await runAdjudication({
            request,
            model,
            transport,
            cache:
              new InMemoryAdjudicationCache(),
            maxAttempts: 3,
            retryDelayMs: 10,
            sleep:
              async (delay) => {
                delays.push(delay);
              },
          });

        expect(result.status).toBe(
          "COMPLETED",
        );

        expect(result.attempts).toBe(
          2,
        );

        expect(calls).toBe(2);

        expect(delays).toEqual([
          10,
        ]);
      },
    );

    test(
      "does not retry a non-retryable transport failure",
      async () => {
        let calls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              calls += 1;

              throw new OpenRouterTransportError(
                "Bad request.",
                {
                  retryable: false,
                  statusCode: 400,
                },
              );
            },
          };

        const result =
          await runAdjudication({
            request,
            model,
            transport,
            cache:
              new InMemoryAdjudicationCache(),
            maxAttempts: 3,
            sleep: async () => {},
          });

        expect(result.status).toBe(
          "FAILED",
        );

        expect(calls).toBe(1);

        expect(result.attempts).toBe(
          1,
        );

        if (
          result.status ===
          "FAILED"
        ) {
          expect(
            result.failure.retryable,
          ).toBe(false);
        }
      },
    );

    test(
      "does not cache an invalid model response",
      async () => {
        const cache =
          new InMemoryAdjudicationCache();

        const transport:
          AdjudicationTransport = {
            async complete() {
              return {
                content:
                  "not json",
                requestId: null,
              };
            },
          };

        const result =
          await runAdjudication({
            request,
            model,
            transport,
            cache,
          });

        expect(result.status).toBe(
          "FAILED",
        );

        if (
          result.status ===
          "FAILED"
        ) {
          expect(
            result.failure.code,
          ).toBe(
            "INVALID_MODEL_RESPONSE",
          );

          expect(
            result.validation,
          ).not.toBeNull();
        }

        expect(
          await cache.get(
            result.cacheKey,
          ),
        ).toBeNull();
      },
    );

    test(
      "persists records through the JSON file cache",
      async () => {
        const filePath =
          `data/adjudication/test-cache-${Date.now()}-${Math.random()}.json`;

        const record:
          AdjudicationCacheRecord = {
            format:
              "adjudication-cache-record-v1",
            key: "cache-key",
            requestHash:
              "request-hash",
            candidateId:
              request.candidateId,
            model,
            promptVersion:
              request.promptVersion,
            rawResponse:
              validResponse(),
            decision:
              abstainDecision(),
            createdAt:
              "2026-07-21T00:00:00.000Z",
          };

        try {
          const first =
            new JsonFileAdjudicationCache(
              filePath,
            );

          await first.set(record);

          const second =
            new JsonFileAdjudicationCache(
              filePath,
            );

          expect(
            await second.get(
              record.key,
            ),
          ).toEqual(record);
        } finally {
          await rm(
            filePath,
            {
              force: true,
            },
          );
        }
      },
    );
  },
);