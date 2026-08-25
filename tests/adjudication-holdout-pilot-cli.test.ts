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
import type {
  HoldoutPilotManifest,
} from "../src/adjudication/build-holdout-pilot-manifest";
import {
  executeHoldoutPilotCommand,
  parseHoldoutPilotArgs,
} from "../src/adjudication/run-holdout-pilot";

const manifest =
  (await Bun.file(
    "data/adjudication/holdout-pilot-manifest.json",
  ).json()) as HoldoutPilotManifest;

function tempReportPath(
  label: string,
): string {
  return [
    "data/adjudication/",
    `test-holdout-pilot-${label}-`,
    Date.now(),
    "-",
    Math.random(),
    ".json",
  ].join("");
}

describe(
  "holdout pilot CLI",
  () => {
    test(
      "uses all manifest candidates and defaults to dry-run",
      () => {
        const options =
          parseHoldoutPilotArgs(
            [
              "--model",
              "test/mock-model",
            ],
            manifest,
          );

        expect(
          options.dryRun,
        ).toBe(true);

        expect(
          options.requestLimit,
        ).toBe(0);

        expect(
          options.candidateIds,
        ).toEqual(
          manifest.candidateIds,
        );

        expect(
          options.candidateIds
            .length,
        ).toBe(22);
      },
    );

    test(
      "rejects manual candidate selection",
      () => {
        expect(() =>
          parseHoldoutPilotArgs(
            [
              "--model",
              "test/mock-model",
              "--candidate-limit",
              "2",
            ],
            manifest,
          ),
        ).toThrow(
          "Holdout pilot candidate selection is fixed by the manifest",
        );

        expect(() =>
          parseHoldoutPilotArgs(
            [
              "--model",
              "test/mock-model",
              "--candidate-id",
              manifest
                .candidateIds[0]!,
            ],
            manifest,
          ),
        ).toThrow(
          "Holdout pilot candidate selection is fixed by the manifest",
        );
      },
    );

    test(
      "requires an explicit request limit for live mode",
      () => {
        expect(() =>
          parseHoldoutPilotArgs(
            [
              "--model",
              "test/mock-model",
              "--live",
            ],
            manifest,
          ),
        ).toThrow(
          "--live requires an explicit --request-limit.",
        );
      },
    );

    test(
      "executes every manifest candidate in dry-run without transport",
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
          const report =
            await executeHoldoutPilotCommand(
              [
                "--model",
                "test/mock-model",
                "--dry-run",
                "--no-resume",
                "--report-path",
                reportPath,
              ],
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
            report.selectedCandidateIds,
          ).toEqual(
            manifest.candidateIds,
          );

          expect(
            report.summary
              .selectedCandidateCount,
          ).toBe(22);

          expect(
            report.summary
              .dryRunCount,
          ).toBe(22);

          expect(
            report.summary
              .terminalResultCount,
          ).toBe(22);

          expect(
            report.stopReason,
          ).toBe("COMPLETED");
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