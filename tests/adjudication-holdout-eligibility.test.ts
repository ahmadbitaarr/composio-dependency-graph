import {
  describe,
  expect,
  test,
} from "bun:test";

import {
  analyzeHoldoutEligibility,
} from "../src/adjudication/analyze-holdout-eligibility";
import type {
  EligibilityReportFile,
} from "../src/adjudication/request-builder";
import type {
  AdjudicationHoldoutFile,
} from "../src/adjudication/score-holdout";

const holdout =
  (await Bun.file(
    "tests/fixtures/adjudication-holdout.json",
  ).json()) as AdjudicationHoldoutFile;

const eligibility =
  (await Bun.file(
    "data/adjudication/eligibility-report.json",
  ).json()) as EligibilityReportFile;

describe(
  "holdout eligibility audit",
  () => {
    test(
      "partitions every frozen holdout case",
      () => {
        const audit =
          analyzeHoldoutEligibility(
            holdout,
            eligibility,
          );

        expect(
          audit.totalCases,
        ).toBe(40);

        expect(
          audit.cases.length,
        ).toBe(40);

        expect(
          audit.retainedEligibleCount +
            audit.notRetainedCount,
        ).toBe(40);

        const categoryTotal =
          Object.values(
            audit.categoryCounts,
          ).reduce(
            (
              total,
              count,
            ) =>
              total + count,
            0,
          );

        expect(
          categoryTotal,
        ).toBe(40);
      },
    );

    test(
      "finds an assessment for every holdout candidate",
      () => {
        const audit =
          analyzeHoldoutEligibility(
            holdout,
            eligibility,
          );

        expect(
          audit
            .missingAssessmentCount,
        ).toBe(0);

        expect(
          audit.invariants
            .allCasesHaveAssessment,
        ).toBe(true);
      },
    );

    test(
      "keeps retained and eligible status consistent",
      () => {
        const audit =
          analyzeHoldoutEligibility(
            holdout,
            eligibility,
          );

        expect(
          audit.invariants
            .retainedCasesAreEligible,
        ).toBe(true);

        expect(
          audit.invariants
            .eligibleCasesAreRetained,
        ).toBe(true);
      },
    );

    test(
      "is deterministic for identical inputs",
      () => {
        const first =
          analyzeHoldoutEligibility(
            holdout,
            eligibility,
          );

        const second =
          analyzeHoldoutEligibility(
            holdout,
            eligibility,
          );

        expect(first).toEqual(
          second,
        );
      },
    );
  },
);