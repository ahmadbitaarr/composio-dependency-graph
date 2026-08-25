import {
  mkdir,
} from "node:fs/promises";

import {
  analyzeHoldoutEligibility,
} from "./analyze-holdout-eligibility";
import type {
  EligibilityReportFile,
} from "./request-builder";
import type {
  AdjudicationHoldoutFile,
} from "./score-holdout";

function errorCode(
  error: unknown,
): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

const holdout =
  (await Bun.file(
    "tests/fixtures/adjudication-holdout.json",
  ).json()) as AdjudicationHoldoutFile;

const eligibility =
  (await Bun.file(
    "data/adjudication/eligibility-report.json",
  ).json()) as EligibilityReportFile;

const audit =
  analyzeHoldoutEligibility(
    holdout,
    eligibility,
  );

try {
  await mkdir(
    "data/adjudication",
    {
      recursive: true,
    },
  );
} catch (error) {
  if (
    errorCode(error) !==
    "EEXIST"
  ) {
    throw error;
  }
}

const outputPath =
  "data/adjudication/holdout-eligibility-audit.json";

await Bun.write(
  outputPath,
  JSON.stringify(
    audit,
    null,
    2,
  ),
);

console.log({
  totalCases:
    audit.totalCases,
  retainedEligibleCount:
    audit.retainedEligibleCount,
  notRetainedCount:
    audit.notRetainedCount,
  missingAssessmentCount:
    audit.missingAssessmentCount,
  categoryCounts:
    audit.categoryCounts,
  invariants:
    audit.invariants,
  llmRequestsMade: false,
  output: outputPath,
});