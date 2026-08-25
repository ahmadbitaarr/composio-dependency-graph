import {
  mkdir,
} from "node:fs/promises";

import type {
  HoldoutEligibilityAudit,
} from "./analyze-holdout-eligibility";
import {
  buildHoldoutPilotManifest,
} from "./build-holdout-pilot-manifest";
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

const audit =
  (await Bun.file(
    "data/adjudication/holdout-eligibility-audit.json",
  ).json()) as HoldoutEligibilityAudit;

const manifest =
  buildHoldoutPilotManifest(
    holdout,
    audit,
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
  "data/adjudication/holdout-pilot-manifest.json";

await Bun.write(
  outputPath,
  JSON.stringify(
    manifest,
    null,
    2,
  ),
);

console.log({
  totalSelected:
    manifest.summary
      .totalSelected,
  github:
    manifest.summary.github,
  googlesuper:
    manifest.summary
      .googlesuper,
  primaryReasonCounts:
    manifest.summary
      .primaryReasonCounts,
  expectedLabelsIncluded:
    manifest.selectionPolicy
      .expectedLabelsIncluded,
  rationalesIncluded:
    manifest.selectionPolicy
      .rationalesIncluded,
  llmRequestsMade: false,
  output: outputPath,
});