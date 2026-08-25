import type {
  HoldoutPilotManifest,
} from "./build-holdout-pilot-manifest";
import {
  executePilotCommand,
  parsePilotArgs,
  pilotSummary,
  type PilotCliOptions,
  type PilotExecutionDependencies,
} from "./run-pilot";
import type {
  AdjudicationRunReport,
} from "./runner";

const DEFAULT_MANIFEST_PATH =
  "data/adjudication/holdout-pilot-manifest.json";

const DEFAULT_CACHE_PATH =
  "data/adjudication/holdout-pilot-cache.json";

const DEFAULT_REPORT_PATH =
  "data/adjudication/holdout-pilot-run.json";

function hasFlag(
  args: string[],
  flag: string,
): boolean {
  return args.includes(flag);
}

function validateManifest(
  manifest: HoldoutPilotManifest,
): void {
  if (
    manifest.format !==
    "adjudication-holdout-pilot-manifest-v1"
  ) {
    throw new Error(
      `Unsupported pilot manifest format: ${manifest.format}`,
    );
  }

  if (
    manifest.selectionPolicy
      .expectedLabelsIncluded ||
    manifest.selectionPolicy
      .rationalesIncluded
  ) {
    throw new Error(
      "Pilot manifest must not contain expected labels or rationales.",
    );
  }

  if (
    manifest.candidateIds.length !==
    manifest.summary.totalSelected
  ) {
    throw new Error(
      "Pilot manifest candidate count does not match its summary.",
    );
  }

  if (
    manifest.candidateIds.length ===
    0
  ) {
    throw new Error(
      "Pilot manifest contains no candidates.",
    );
  }

  if (
    new Set(
      manifest.candidateIds,
    ).size !==
    manifest.candidateIds.length
  ) {
    throw new Error(
      "Pilot manifest contains duplicate candidate IDs.",
    );
  }
}

export function parseHoldoutPilotArgs(
  args: string[],
  manifest: HoldoutPilotManifest,
): PilotCliOptions {
  validateManifest(manifest);

  if (
    hasFlag(
      args,
      "--candidate-id",
    ) ||
    hasFlag(
      args,
      "--candidate-limit",
    )
  ) {
    throw new Error(
      "Holdout pilot candidate selection is fixed by the manifest; do not pass --candidate-id or --candidate-limit.",
    );
  }

  const expandedArgs = [
    ...args,
  ];

  if (
    !hasFlag(
      expandedArgs,
      "--cache-path",
    )
  ) {
    expandedArgs.push(
      "--cache-path",
      DEFAULT_CACHE_PATH,
    );
  }

  if (
    !hasFlag(
      expandedArgs,
      "--report-path",
    )
  ) {
    expandedArgs.push(
      "--report-path",
      DEFAULT_REPORT_PATH,
    );
  }

  for (
    const candidateId
    of manifest.candidateIds
  ) {
    expandedArgs.push(
      "--candidate-id",
      candidateId,
    );
  }

  return parsePilotArgs(
    expandedArgs,
  );
}

export async function executeHoldoutPilotCommand(
  args: string[],
  dependencies:
    PilotExecutionDependencies = {},
  manifestPath =
    DEFAULT_MANIFEST_PATH,
): Promise<
  AdjudicationRunReport
> {
  const manifest =
    (await Bun.file(
      manifestPath,
    ).json()) as HoldoutPilotManifest;

  const options =
    parseHoldoutPilotArgs(
      args,
      manifest,
    );

  return executePilotCommand(
    options,
    dependencies,
  );
}

if (import.meta.main) {
  try {
    const report =
      await executeHoldoutPilotCommand(
        Bun.argv.slice(2),
      );

    console.log(
      JSON.stringify(
        pilotSummary(report),
        null,
        2,
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(message);
    process.exitCode = 1;
  }
}