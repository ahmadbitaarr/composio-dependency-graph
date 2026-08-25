import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  rm,
} from "node:fs/promises";

import {
  InMemoryAdjudicationCache,
} from "../src/adjudication/cache";
import type {
  AdjudicationTransport,
} from "../src/adjudication/client";
import {
  executePilotCommand,
  parsePilotArgs,
  pilotSummary,
} from "../src/adjudication/run-pilot";

function tempReportPath(
  label: string,
): string {
  return [
    "data/adjudication/",
    `test-pilot-${label}-`,
    Date.now(),
    "-",
    Math.random(),
    ".json",
  ].join("");
}

describe(
  "adjudication pilot CLI",
  () => {
    test(
      "defaults to dry-run and requires explicit selection",
      () => {
        const options =
          parsePilotArgs([
            "--model",
            "test/mock-model",
            "--candidate-limit",
            "2",
          ]);

        expect(
          options.dryRun,
        ).toBe(true);

        expect(
          options.requestLimit,
        ).toBe(0);

        expect(
          options.candidateLimit,
        ).toBe(2);
      },
    );

    test(
      "rejects missing candidate selection",
      () => {
        expect(() =>
          parsePilotArgs([
            "--model",
            "test/mock-model",
          ]),
        ).toThrow(
          "Provide at least one --candidate-id or an explicit --candidate-limit.",
        );
      },
    );

    test(
      "requires a request limit for live execution",
      () => {
        expect(() =>
          parsePilotArgs([
            "--model",
            "test/mock-model",
            "--candidate-limit",
            "2",
            "--live",
          ]),
        ).toThrow(
          "--live requires an explicit --request-limit.",
        );
      },
    );

    test(
      "parses repeated candidate IDs",
      () => {
        const options =
          parsePilotArgs([
            "--model",
            "test/mock-model",
            "--candidate-id",
            "candidate-one",
            "--candidate-id",
            "candidate-two",
            "--live",
            "--request-limit",
            "2",
          ]);

        expect(
          options.candidateIds,
        ).toEqual([
          "candidate-one",
          "candidate-two",
        ]);

        expect(
          options.dryRun,
        ).toBe(false);

        expect(
          options.requestLimit,
        ).toBe(2);
      },
    );

    test(
      "executes dry-run without calling transport",
      async () => {
        const reportPath =
          tempReportPath(
            "dry-run",
          );

        let transportCalls = 0;

        const transport:
          AdjudicationTransport = {
            async complete() {
              transportCalls += 1;

              throw new Error(
                "Dry-run must not call transport.",
              );
            },
          };

        try {
          const options =
            parsePilotArgs([
              "--model",
              "test/mock-model",
              "--candidate-limit",
              "2",
              "--report-path",
              reportPath,
            ]);

          const report =
            await executePilotCommand(
              options,
              {
                transport,
                cache:
                  new InMemoryAdjudicationCache(),
              },
            );

          expect(
            transportCalls,
          ).toBe(0);

          expect(
            report.requestCount,
          ).toBe(0);

          expect(
            report.summary
              .dryRunCount,
          ).toBe(2);

          expect(
            report.stopReason,
          ).toBe("COMPLETED");

          const summary =
            pilotSummary(report);

          expect(
            summary
              .llmRequestsMade,
          ).toBe(false);
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