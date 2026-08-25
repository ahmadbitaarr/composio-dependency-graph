import {
  mkdir,
} from "node:fs/promises";

import type {
  HoldoutPilotManifest,
} from "./build-holdout-pilot-manifest";
import type {
  AdjudicationRunReport,
} from "./runner";
import {
  scoreHoldoutPilotRun,
} from "./score-holdout-pilot-run";
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

function flagValue(
  args: string[],
  flag: string,
  defaultValue: string,
): string {
  const index =
    args.indexOf(flag);

  if (index < 0) {
    return defaultValue;
  }

  const value =
    args[index + 1];

  if (
    !value ||
    value.startsWith("--")
  ) {
    throw new Error(
      `${flag} requires a value.`,
    );
  }

  return value;
}

const args =
  Bun.argv.slice(2);

const runPath =
  flagValue(
    args,
    "--run-path",
    "data/adjudication/holdout-pilot-run.json",
  );

const outputPath =
  flagValue(
    args,
    "--output-path",
    "data/adjudication/holdout-pilot-score.json",
  );

const holdout =
  (await Bun.file(
    "tests/fixtures/adjudication-holdout.json",
  ).json()) as AdjudicationHoldoutFile;

const manifest =
  (await Bun.file(
    "data/adjudication/holdout-pilot-manifest.json",
  ).json()) as HoldoutPilotManifest;

const run =
  (await Bun.file(
    runPath,
  ).json()) as AdjudicationRunReport;

const report =
  scoreHoldoutPilotRun(
    holdout,
    manifest,
    run,
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

await Bun.write(
  outputPath,
  JSON.stringify(
    report,
    null,
    2,
  ),
);

console.log({
  model: report.source.model,
  totalSelected:
    report.selection
      .totalSelected,
  dryRun:
    report.execution.dryRun,
  requestCount:
    report.execution
      .requestCount,
  validDecisionCount:
    report.score
      .validDecisionCount,
  dryRunResultCount:
    report.score
      .dryRunResultCount,
  missingResultCount:
    report.score
      .missingResultCount,
  unsupportedAcceptCount:
    report.score.decisions
      .accept
      .unsupportedAcceptCount,
  safetyGatePassed:
    report.safetyGate.passed,
  llmRequestsMade:
    report.execution
      .requestCount > 0,
  output: outputPath,
});