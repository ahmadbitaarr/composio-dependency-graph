import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
} from "node:path";

import type {
  DecisionArtifact,
} from "../matching";
import type {
  NormalizedToolCatalog,
} from "../types";
import type {
  AdjudicationCache,
} from "./cache";
import {
  OpenRouterTransportError,
  runAdjudication,
  type AdjudicationExecutionResult,
  type AdjudicationTransport,
} from "./client";
import {
  ADJUDICATION_PROMPT_VERSION,
  buildAdjudicationRequest,
  type EligibilityReportFile,
} from "./request-builder";

export const MAX_SAFE_PILOT_CANDIDATES =
  40;

export type AdjudicationRunStopReason =
  | "COMPLETED"
  | "REQUEST_LIMIT_REACHED";

export type AdjudicationRunSummary = {
  selectedCandidateCount: number;
  terminalResultCount: number;
  completedCount: number;
  cacheHitCount: number;
  dryRunCount: number;
  failedCount: number;
  requestCount: number;
  resumedResultCount: number;
};

export type AdjudicationRunReport = {
  format:
    "adjudication-run-report-v1";
  model: string;
  promptVersion:
    typeof ADJUDICATION_PROMPT_VERSION;
  dryRun: boolean;
  requestLimit: number;
  maxAttemptsPerCandidate: number;
  selectedCandidateIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  stopReason:
    AdjudicationRunStopReason | null;
  requestCount: number;
  results: Record<
    string,
    AdjudicationExecutionResult
  >;
  summary:
    AdjudicationRunSummary;
};

export type RunAdjudicationBatchOptions = {
  uncertain: DecisionArtifact;
  eligibility:
    EligibilityReportFile;
  catalog: NormalizedToolCatalog;
  model: string;
  transport:
    AdjudicationTransport;
  cache: AdjudicationCache;
  reportPath: string;
  candidateIds?: string[];
  candidateLimit?: number;
  requestLimit?: number;
  dryRun?: boolean;
  resume?: boolean;
  timeoutMs?: number;
  maxAttemptsPerCandidate?: number;
  retryDelayMs?: number;
  sleep?: (
    milliseconds: number,
  ) => Promise<void>;
  now?: () => Date;
};

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

function uniqueStrings(
  values: string[],
): string[] {
  return [...new Set(values)];
}

function sameStringArray(
  left: string[],
  right: string[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value === right[index],
    )
  );
}

export function selectAdjudicationCandidateIds(
  eligibility:
    EligibilityReportFile,
  options: {
    candidateIds?: string[];
    candidateLimit?: number;
  },
): string[] {
  const retained =
    new Set(
      eligibility
        .retainedCandidateIds,
    );

  const requested =
    options.candidateIds
      ? uniqueStrings(
          options.candidateIds,
        )
      : eligibility
          .retainedCandidateIds;

  if (
    options.candidateIds &&
    requested.length === 0
  ) {
    throw new Error(
      "candidateIds must contain at least one candidate.",
    );
  }

  for (
    const candidateId
    of requested
  ) {
    if (
      !retained.has(candidateId)
    ) {
      throw new Error(
        `Candidate is not retained as eligible: ${candidateId}`,
      );
    }
  }

  const candidateLimit =
    options.candidateLimit ??
    (
      options.candidateIds
        ? requested.length
        : undefined
    );

  if (
    candidateLimit ===
    undefined
  ) {
    throw new Error(
      "candidateLimit is required when candidateIds are not explicitly provided.",
    );
  }

  if (
    !Number.isInteger(
      candidateLimit,
    ) ||
    candidateLimit < 1
  ) {
    throw new Error(
      "candidateLimit must be a positive integer.",
    );
  }

  if (
    candidateLimit >
    MAX_SAFE_PILOT_CANDIDATES
  ) {
    throw new Error(
      `candidateLimit cannot exceed ${MAX_SAFE_PILOT_CANDIDATES} during the limited pilot phase.`,
    );
  }

  return requested.slice(
    0,
    candidateLimit,
  );
}

function emptySummary(
  selectedCandidateCount:
    number,
): AdjudicationRunSummary {
  return {
    selectedCandidateCount,
    terminalResultCount: 0,
    completedCount: 0,
    cacheHitCount: 0,
    dryRunCount: 0,
    failedCount: 0,
    requestCount: 0,
    resumedResultCount: 0,
  };
}

function summarize(
  report:
    AdjudicationRunReport,
  resumedResultCount:
    number,
): AdjudicationRunSummary {
  let completedCount = 0;
  let cacheHitCount = 0;
  let dryRunCount = 0;
  let failedCount = 0;

  const results =
    Object.values(
      report.results,
    );

  for (
    const result
    of results
  ) {
    switch (result.status) {
      case "COMPLETED":
        completedCount += 1;
        break;

      case "CACHE_HIT":
        cacheHitCount += 1;
        break;

      case "DRY_RUN":
        dryRunCount += 1;
        break;

      case "FAILED":
        failedCount += 1;
        break;
    }
  }

  return {
    selectedCandidateCount:
      report
        .selectedCandidateIds
        .length,
    terminalResultCount:
      results.length,
    completedCount,
    cacheHitCount,
    dryRunCount,
    failedCount,
    requestCount:
      report.requestCount,
    resumedResultCount,
  };
}

async function ensureParentDirectory(
  filePath: string,
): Promise<void> {
  try {
    await mkdir(
      dirname(filePath),
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
}

async function writeRunReport(
  filePath: string,
  report:
    AdjudicationRunReport,
): Promise<void> {
  await ensureParentDirectory(
    filePath,
  );

  await writeFile(
    filePath,
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );
}

async function readRunReport(
  filePath: string,
): Promise<
  AdjudicationRunReport | null
> {
  try {
    const content =
      await readFile(
        filePath,
        "utf8",
      );

    const parsed =
      JSON.parse(
        content,
      ) as Partial<
        AdjudicationRunReport
      >;

    if (
      parsed.format !==
        "adjudication-run-report-v1" ||
      typeof parsed.model !==
        "string" ||
      !Array.isArray(
        parsed
          .selectedCandidateIds,
      ) ||
      typeof parsed.results !==
        "object" ||
      parsed.results === null ||
      typeof parsed.requestCount !==
        "number"
    ) {
      throw new Error(
        `Invalid adjudication run report: ${filePath}`,
      );
    }

    return parsed as
      AdjudicationRunReport;
  } catch (error) {
    if (
      errorCode(error) ===
      "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

function assertCompatibleReport(
  report:
    AdjudicationRunReport,
  options: {
    model: string;
    dryRun: boolean;
    selectedCandidateIds:
      string[];
    requestLimit: number;
  },
): void {
  if (
    report.model !==
    options.model
  ) {
    throw new Error(
      "Existing run report uses a different model.",
    );
  }

  if (
    report.promptVersion !==
    ADJUDICATION_PROMPT_VERSION
  ) {
    throw new Error(
      "Existing run report uses a different prompt version.",
    );
  }

  if (
    report.dryRun !==
    options.dryRun
  ) {
    throw new Error(
      "Existing run report uses a different dry-run setting.",
    );
  }

  if (
    !sameStringArray(
      report
        .selectedCandidateIds,
      options
        .selectedCandidateIds,
    )
  ) {
    throw new Error(
      "Existing run report uses a different candidate selection.",
    );
  }

  if (
    report.requestCount >
    options.requestLimit
  ) {
    throw new Error(
      "requestLimit cannot be lower than the number of requests already recorded.",
    );
  }
}

export async function runAdjudicationBatch(
  options:
    RunAdjudicationBatchOptions,
): Promise<
  AdjudicationRunReport
> {
  const dryRun =
    options.dryRun ?? false;

  const resume =
    options.resume ?? true;

  const model =
    options.model.trim();

  if (!model) {
    throw new Error(
      "An explicit model ID is required.",
    );
  }

  const selectedCandidateIds =
    selectAdjudicationCandidateIds(
      options.eligibility,
      {
        candidateIds:
          options.candidateIds,
        candidateLimit:
          options.candidateLimit,
      },
    );

  const requestLimit =
    options.requestLimit ??
    (
      dryRun
        ? 0
        : undefined
    );

  if (
    requestLimit ===
    undefined
  ) {
    throw new Error(
      "requestLimit is required for a non-dry-run batch.",
    );
  }

  if (
    !Number.isInteger(
      requestLimit,
    ) ||
    requestLimit < 0
  ) {
    throw new Error(
      "requestLimit must be a non-negative integer.",
    );
  }

  if (
    !dryRun &&
    requestLimit < 1
  ) {
    throw new Error(
      "A non-dry-run batch requires a positive requestLimit.",
    );
  }

  const maxAttemptsPerCandidate =
    options
      .maxAttemptsPerCandidate ??
    2;

  if (
    !Number.isInteger(
      maxAttemptsPerCandidate,
    ) ||
    maxAttemptsPerCandidate < 1
  ) {
    throw new Error(
      "maxAttemptsPerCandidate must be a positive integer.",
    );
  }

  const now =
    options.now ??
    (() => new Date());

  const existing =
    resume
      ? await readRunReport(
          options.reportPath,
        )
      : null;

  let resumedResultCount = 0;

  let report:
    AdjudicationRunReport;

  if (existing) {
    assertCompatibleReport(
      existing,
      {
        model,
        dryRun,
        selectedCandidateIds,
        requestLimit,
      },
    );

    report = existing;
    report.requestLimit =
      requestLimit;
    report
      .maxAttemptsPerCandidate =
      maxAttemptsPerCandidate;

    resumedResultCount =
      Object.keys(
        report.results,
      ).length;

    report.stopReason = null;
    report.completedAt = null;
  } else {
    const startedAt =
      now().toISOString();

    report = {
      format:
        "adjudication-run-report-v1",
      model,
      promptVersion:
        ADJUDICATION_PROMPT_VERSION,
      dryRun,
      requestLimit,
      maxAttemptsPerCandidate,
      selectedCandidateIds,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      stopReason: null,
      requestCount: 0,
      results: {},
      summary:
        emptySummary(
          selectedCandidateIds
            .length,
        ),
    };
  }

  for (
    const candidateId
    of selectedCandidateIds
  ) {
    if (
      report.results[
        candidateId
      ]
    ) {
      continue;
    }

    if (
      !dryRun &&
      report.requestCount >=
        requestLimit
    ) {
      break;
    }

    const request =
      buildAdjudicationRequest(
        candidateId,
        options.uncertain,
        options.eligibility,
        options.catalog,
      );

    const remainingRequests =
      dryRun
        ? maxAttemptsPerCandidate
        : requestLimit -
          report.requestCount;

    if (
      !dryRun &&
      remainingRequests < 1
    ) {
      break;
    }

    const allowedAttempts =
      dryRun
        ? maxAttemptsPerCandidate
        : Math.min(
            maxAttemptsPerCandidate,
            remainingRequests,
          );

    const budgetedTransport:
      AdjudicationTransport = {
        async complete(input) {
          if (
            report.requestCount >=
            requestLimit
          ) {
            throw new OpenRouterTransportError(
              "Adjudication request limit reached.",
              {
                retryable: false,
              },
            );
          }

          report.requestCount += 1;
          report.updatedAt =
            now().toISOString();
          report.summary =
            summarize(
              report,
              resumedResultCount,
            );

          await writeRunReport(
            options.reportPath,
            report,
          );

          return options
            .transport
            .complete(input);
        },
      };

    const result =
      await runAdjudication({
        request,
        model,
        transport:
          budgetedTransport,
        cache: options.cache,
        dryRun,
        timeoutMs:
          options.timeoutMs,
        maxAttempts:
          allowedAttempts,
        retryDelayMs:
          options.retryDelayMs,
        sleep: options.sleep,
        now,
      });

    report.results[
      candidateId
    ] = result;

    report.updatedAt =
      now().toISOString();

    report.summary =
      summarize(
        report,
        resumedResultCount,
      );

    await writeRunReport(
      options.reportPath,
      report,
    );
  }

  const allCandidatesFinished =
    Object.keys(
      report.results,
    ).length ===
    selectedCandidateIds.length;

  report.stopReason =
    allCandidatesFinished
      ? "COMPLETED"
      : "REQUEST_LIMIT_REACHED";

  report.completedAt =
    allCandidatesFinished
      ? now().toISOString()
      : null;

  report.updatedAt =
    now().toISOString();

  report.summary =
    summarize(
      report,
      resumedResultCount,
    );

  await writeRunReport(
    options.reportPath,
    report,
  );

  return report;
}