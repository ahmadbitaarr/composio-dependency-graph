import {
  mkdir,
} from "node:fs/promises";

import type {
  DecisionArtifact,
} from "../matching";
import type {
  NormalizedToolCatalog,
} from "../types";
import {
  assessUncertainArtifact,
  type EligibilityAssessment,
  type EligibilityCategory,
} from "./eligibility";
import {
  createSemanticHashContext,
  deduplicateEligibleCandidates,
  semanticCandidateHashWithContext,
} from "./deduplicate";

const UNCERTAIN_PATH =
  "data/candidates.uncertain.json";

const CATALOG_PATH =
  "data/normalized-tools.json";

const OUTPUT_PATH =
  "data/adjudication/eligibility-report.json";

const CATEGORIES:
  EligibilityCategory[] = [
    "ELIGIBLE",
    "INELIGIBLE_HARD_CONFLICT",
    "INELIGIBLE_INSUFFICIENT_EVIDENCE",
    "INELIGIBLE_DUPLICATE",
    "INELIGIBLE_LOW_VALUE",
  ];

function increment(
  counts: Record<string, number>,
  key: string,
): void {
  counts[key] =
    (counts[key] ?? 0) + 1;
}

const uncertain =
  (await Bun.file(
    UNCERTAIN_PATH,
  ).json()) as DecisionArtifact;

const catalog =
  (await Bun.file(
    CATALOG_PATH,
  ).json()) as NormalizedToolCatalog;

const semanticHashContext =
  createSemanticHashContext(catalog);

const initialAssessments =
  assessUncertainArtifact(
    uncertain,
    catalog,
  );

const initialById = new Map(
  initialAssessments.map(
    (assessment) => [
      assessment.candidateId,
      assessment,
    ],
  ),
);

const initiallyEligible =
  uncertain.candidates.filter(
    (candidate) =>
      initialById.get(candidate.id)
        ?.category === "ELIGIBLE",
  );

const deduplication =
  deduplicateEligibleCandidates(
    initiallyEligible,
    catalog,
  );

const retainedIds = new Set(
  deduplication.retained.map(
    (candidate) => candidate.id,
  ),
);

const finalAssessments:
  EligibilityAssessment[] =
    uncertain.candidates.map(
      (candidate) => {
        const initial =
          initialById.get(candidate.id);

        if (!initial) {
          throw new Error(
            `Missing assessment for ${candidate.id}`,
          );
        }

        const duplicateOf =
          deduplication.duplicateOf[
            candidate.id
          ];

        if (!duplicateOf) {
          return {
            ...initial,
            semanticCluster:
              initial.category ===
              "ELIGIBLE"
                ? semanticCandidateHashWithContext(
                    candidate,
                    semanticHashContext,
                  )
                : undefined,
          };
        }

        return {
          candidateId: candidate.id,
          category:
            "INELIGIBLE_DUPLICATE",
          reasonCodes: [
            "SEMANTIC_DUPLICATE",
          ],
          explanation:
            "An equivalent evidence pattern is represented by another retained candidate.",
          resolvableQuestions:
            initial.resolvableQuestions,
          duplicateOf,
          semanticCluster:
            semanticCandidateHashWithContext(
              candidate,
              semanticHashContext,
            ),
        };
      },
    );

const categoryCounts =
  Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      0,
    ]),
  ) as Record<
    EligibilityCategory,
    number
  >;

const reasonCodeCounts:
  Record<string, number> = {};

for (
  const assessment of
  finalAssessments
) {
  categoryCounts[
    assessment.category
  ] += 1;

  for (
    const reasonCode of
    assessment.reasonCodes
  ) {
    increment(
      reasonCodeCounts,
      reasonCode,
    );
  }
}

const partitionCount =
  Object.values(
    categoryCounts,
  ).reduce(
    (total, count) =>
      total + count,
    0,
  );

if (
  partitionCount !==
  uncertain.candidates.length
) {
  throw new Error(
    `Eligibility partition mismatch: ${partitionCount} !== ${uncertain.candidates.length}`,
  );
}

if (
  retainedIds.size !==
  categoryCounts.ELIGIBLE
) {
  throw new Error(
    "Retained candidate count does not match final ELIGIBLE count.",
  );
}

const report = {
  format:
    "adjudication-eligibility-report-v1",
  source: {
    uncertainArtifactFormat:
      uncertain.format,
    uncertainCandidateCount:
      uncertain.summary.candidateCount,
    catalogFormat: catalog.format,
    catalogToolCount:
      catalog.summary.toolCount,
    toolkitVersions:
      uncertain.generatedFrom
        .toolkitVersions,
  },
  rules: {
    deterministicAcceptedCandidatesModified:
      false,
    deterministicRejectedCandidatesModified:
      false,
    llmRequestsMade: false,
    semanticDeduplication: true,
  },
  summary: {
    uncertainTotal:
      uncertain.candidates.length,
    eligibleBeforeDeduplication:
      initiallyEligible.length,
    eligibilityCategoryCounts:
      categoryCounts,
    ineligibleReasonCounts:
      Object.fromEntries(
        Object.entries(
          reasonCodeCounts,
        ).sort(([left], [right]) =>
          left < right
            ? -1
            : left > right
              ? 1
              : 0,
        ),
      ),
    duplicateClusterCount:
      deduplication.clusters.length,
    duplicateCandidateCount:
      Object.keys(
        deduplication.duplicateOf,
      ).length,
    candidatesRetainedAfterDeduplication:
      deduplication.retained.length,
  },
  retainedCandidateIds:
    deduplication.retained.map(
      (candidate) => candidate.id,
    ),
  duplicateClusters:
    deduplication.clusters,
  assessments:
    finalAssessments.sort(
      (left, right) =>
        left.candidateId <
        right.candidateId
          ? -1
          : left.candidateId >
              right.candidateId
            ? 1
            : 0,
    ),
};

await mkdir(
  "data/adjudication",
  {
    recursive: true,
  },
);

await Bun.write(
  OUTPUT_PATH,
  JSON.stringify(report, null, 2),
);

console.log({
  uncertainTotal:
    report.summary.uncertainTotal,
  eligibleBeforeDeduplication:
    report.summary
      .eligibleBeforeDeduplication,
  eligibilityCategoryCounts:
    report.summary
      .eligibilityCategoryCounts,
  duplicateClusterCount:
    report.summary
      .duplicateClusterCount,
  duplicateCandidateCount:
    report.summary
      .duplicateCandidateCount,
  candidatesRetainedAfterDeduplication:
    report.summary
      .candidatesRetainedAfterDeduplication,
  llmRequestsMade:
    report.rules.llmRequestsMade,
  output: OUTPUT_PATH,
});