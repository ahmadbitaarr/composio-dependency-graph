import type {
  DecisionArtifact,
} from "../matching";
import type {
  NormalizedToolCatalog,
} from "../types";
import {
  InMemoryAdjudicationCache,
  JsonFileAdjudicationCache,
  type AdjudicationCache,
} from "./cache";
import {
  createOpenRouterHttpTransport,
  type AdjudicationTransport,
} from "./client";
import type {
  EligibilityReportFile,
} from "./request-builder";
import {
  runAdjudicationBatch,
  type AdjudicationRunReport,
} from "./runner";

export type PilotCliOptions = {
  model: string;
  dryRun: boolean;
  candidateIds: string[];
  candidateLimit:
    number | undefined;
  requestLimit: number;
  cachePath: string;
  reportPath: string;
  resume: boolean;
  timeoutMs: number;
  maxAttemptsPerCandidate:
    number;
  retryDelayMs: number;
};

export type PilotExecutionDependencies = {
  transport?:
    AdjudicationTransport;
  cache?: AdjudicationCache;
  sleep?: (
    milliseconds: number,
  ) => Promise<void>;
  now?: () => Date;
};

function requiredFlagValue(
  args: string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];

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

function integerFlagValue(
  value: string,
  flag: string,
  options: {
    minimum: number;
  },
): number {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < options.minimum
  ) {
    throw new Error(
      `${flag} must be an integer greater than or equal to ${options.minimum}.`,
    );
  }

  return parsed;
}

export function parsePilotArgs(
  args: string[],
): PilotCliOptions {
  let model:
    string | undefined;

  let explicitDryRun = false;
  let live = false;

  const candidateIds:
    string[] = [];

  let candidateLimit:
    number | undefined;

  let requestLimit:
    number | undefined;

  let cachePath =
    "data/adjudication/pilot-cache.json";

  let reportPath =
    "data/adjudication/pilot-run.json";

  let resume = true;
  let timeoutMs = 30_000;

  let maxAttemptsPerCandidate =
    2;

  let retryDelayMs = 250;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument = args[index];

    switch (argument) {
      case "--model": {
        model =
          requiredFlagValue(
            args,
            index,
            argument,
          );

        index += 1;
        break;
      }

      case "--dry-run":
        explicitDryRun = true;
        break;

      case "--live":
        live = true;
        break;

      case "--candidate-id": {
        candidateIds.push(
          requiredFlagValue(
            args,
            index,
            argument,
          ),
        );

        index += 1;
        break;
      }

      case "--candidate-limit": {
        candidateLimit =
          integerFlagValue(
            requiredFlagValue(
              args,
              index,
              argument,
            ),
            argument,
            {
              minimum: 1,
            },
          );

        index += 1;
        break;
      }

      case "--request-limit": {
        requestLimit =
          integerFlagValue(
            requiredFlagValue(
              args,
              index,
              argument,
            ),
            argument,
            {
              minimum: 1,
            },
          );

        index += 1;
        break;
      }

      case "--cache-path": {
        cachePath =
          requiredFlagValue(
            args,
            index,
            argument,
          );

        index += 1;
        break;
      }

      case "--report-path": {
        reportPath =
          requiredFlagValue(
            args,
            index,
            argument,
          );

        index += 1;
        break;
      }

      case "--no-resume":
        resume = false;
        break;

      case "--timeout-ms": {
        timeoutMs =
          integerFlagValue(
            requiredFlagValue(
              args,
              index,
              argument,
            ),
            argument,
            {
              minimum: 1,
            },
          );

        index += 1;
        break;
      }

      case "--max-attempts": {
        maxAttemptsPerCandidate =
          integerFlagValue(
            requiredFlagValue(
              args,
              index,
              argument,
            ),
            argument,
            {
              minimum: 1,
            },
          );

        index += 1;
        break;
      }

      case "--retry-delay-ms": {
        retryDelayMs =
          integerFlagValue(
            requiredFlagValue(
              args,
              index,
              argument,
            ),
            argument,
            {
              minimum: 0,
            },
          );

        index += 1;
        break;
      }

      default:
        throw new Error(
          `Unknown argument: ${argument}`,
        );
    }
  }

  if (
    explicitDryRun &&
    live
  ) {
    throw new Error(
      "--dry-run and --live cannot be used together.",
    );
  }

  if (!model?.trim()) {
    throw new Error(
      "--model is required.",
    );
  }

  if (
    candidateIds.length === 0 &&
    candidateLimit === undefined
  ) {
    throw new Error(
      "Provide at least one --candidate-id or an explicit --candidate-limit.",
    );
  }

  if (
    candidateIds.length > 0 &&
    candidateLimit !== undefined
  ) {
    throw new Error(
      "Use either --candidate-id or --candidate-limit, not both.",
    );
  }

  const dryRun = !live;

  if (
    dryRun &&
    requestLimit !== undefined
  ) {
    throw new Error(
      "--request-limit is only valid with --live.",
    );
  }

  if (
    !dryRun &&
    requestLimit === undefined
  ) {
    throw new Error(
      "--live requires an explicit --request-limit.",
    );
  }

  return {
    model: model.trim(),
    dryRun,
    candidateIds,
    candidateLimit,
    requestLimit:
      dryRun
        ? 0
        : requestLimit!,
    cachePath,
    reportPath,
    resume,
    timeoutMs,
    maxAttemptsPerCandidate,
    retryDelayMs,
  };
}

async function readJson<T>(
  path: string,
): Promise<T> {
  return (
    await Bun.file(path).json()
  ) as T;
}

export async function executePilotCommand(
  options: PilotCliOptions,
  dependencies:
    PilotExecutionDependencies = {},
): Promise<
  AdjudicationRunReport
> {
  const [
    uncertain,
    catalog,
    eligibility,
  ] = await Promise.all([
    readJson<DecisionArtifact>(
      "data/candidates.uncertain.json",
    ),
    readJson<NormalizedToolCatalog>(
      "data/normalized-tools.json",
    ),
    readJson<EligibilityReportFile>(
      "data/adjudication/eligibility-report.json",
    ),
  ]);

  const transport =
    dependencies.transport ??
    createOpenRouterHttpTransport();

  const cache =
    dependencies.cache ??
    new JsonFileAdjudicationCache(
      options.cachePath,
    );

  return runAdjudicationBatch({
    uncertain,
    eligibility,
    catalog,
    model: options.model,
    transport,
    cache,
    reportPath:
      options.reportPath,
    candidateIds:
      options.candidateIds.length >
      0
        ? options.candidateIds
        : undefined,
    candidateLimit:
      options.candidateLimit,
    requestLimit:
      options.requestLimit,
    dryRun:
      options.dryRun,
    resume:
      options.resume,
    timeoutMs:
      options.timeoutMs,
    maxAttemptsPerCandidate:
      options
        .maxAttemptsPerCandidate,
    retryDelayMs:
      options.retryDelayMs,
    sleep:
      dependencies.sleep,
    now:
      dependencies.now,
  });
}

export function pilotSummary(
  report:
    AdjudicationRunReport,
): Record<string, unknown> {
  return {
    model: report.model,
    promptVersion:
      report.promptVersion,
    dryRun: report.dryRun,
    selectedCandidateCount:
      report
        .selectedCandidateIds
        .length,
    requestLimit:
      report.requestLimit,
    requestCount:
      report.requestCount,
    llmRequestsMade:
      report.requestCount > 0,
    stopReason:
      report.stopReason,
    reportSummary:
      report.summary,
  };
}

if (import.meta.main) {
  try {
    const options =
      parsePilotArgs(
        Bun.argv.slice(2),
      );

    const report =
      await executePilotCommand(
        options,
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