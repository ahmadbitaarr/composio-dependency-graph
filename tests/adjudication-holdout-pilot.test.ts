import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  HoldoutEligibilityAudit,
} from "../src/adjudication/analyze-holdout-eligibility";
import {
  buildHoldoutPilotManifest,
} from "../src/adjudication/build-holdout-pilot-manifest";
import type {
  AdjudicationHoldoutFile,
} from "../src/adjudication/score-holdout";

const holdout =
  (await Bun.file(
    "tests/fixtures/adjudication-holdout.json",
  ).json()) as AdjudicationHoldoutFile;

const audit =
  (await Bun.file(
    "data/adjudication/holdout-eligibility-audit.json",
  ).json()) as HoldoutEligibilityAudit;

describe(
  "holdout pilot manifest",
  () => {
    test(
      "selects exactly the retained eligible holdout cases",
      () => {
        const manifest =
          buildHoldoutPilotManifest(
            holdout,
            audit,
          );

        expect(
          manifest.summary
            .totalSelected,
        ).toBe(
          audit
            .retainedEligibleCount,
        );

        expect(
          manifest.summary
            .totalSelected,
        ).toBe(22);

        expect(
          manifest.cases.length,
        ).toBe(22);

        expect(
          manifest
            .candidateIds.length,
        ).toBe(22);

        expect(
          manifest.summary.github +
            manifest.summary
              .googlesuper,
        ).toBe(22);
      },
    );

    test(
      "contains only retained ELIGIBLE candidates",
      () => {
        const manifest =
          buildHoldoutPilotManifest(
            holdout,
            audit,
          );

        const auditByCandidateId =
          new Map(
            audit.cases.map(
              (auditCase) => [
                auditCase
                  .candidateId,
                auditCase,
              ],
            ),
          );

        for (
          const pilotCase
          of manifest.cases
        ) {
          const auditCase =
            auditByCandidateId.get(
              pilotCase.candidateId,
            );

          expect(
            auditCase?.retained,
          ).toBe(true);

          expect(
            auditCase?.category,
          ).toBe("ELIGIBLE");
        }
      },
    );

    test(
      "does not leak expected labels or rationales",
      () => {
        const manifest =
          buildHoldoutPilotManifest(
            holdout,
            audit,
          );

        const serialized =
          JSON.stringify(manifest);

        expect(
          serialized,
        ).not.toContain(
          "expectedDecision",
        );

        expect(
          serialized,
        ).not.toContain(
          "expectedDependencyKind",
        );

        expect(
          serialized,
        ).not.toContain(
          "expectedSelectionRequired",
        );

        expect(
          serialized,
        ).not.toContain(
          "expectedDisambiguationRequired",
        );

        expect(
          serialized,
        ).not.toContain(
          "expectedTransformationRequired",
        );

        expect(
        serialized,
        ).not.toContain(
        '"rationale":',
        );

        expect(
          manifest.selectionPolicy
            .expectedLabelsIncluded,
        ).toBe(false);

        expect(
          manifest.selectionPolicy
            .rationalesIncluded,
        ).toBe(false);
      },
    );

    test(
      "uses unique candidate and holdout case IDs",
      () => {
        const manifest =
          buildHoldoutPilotManifest(
            holdout,
            audit,
          );

        expect(
          new Set(
            manifest.candidateIds,
          ).size,
        ).toBe(
          manifest
            .candidateIds.length,
        );

        expect(
          new Set(
            manifest.cases.map(
              (pilotCase) =>
                pilotCase
                  .holdoutCaseId,
            ),
          ).size,
        ).toBe(
          manifest.cases.length,
        );
      },
    );

    test(
      "is deterministic",
      () => {
        const first =
          buildHoldoutPilotManifest(
            holdout,
            audit,
          );

        const second =
          buildHoldoutPilotManifest(
            holdout,
            audit,
          );

        expect(first).toEqual(
          second,
        );
      },
    );
  },
);