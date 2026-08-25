import {
  describe,
  expect,
  test,
} from "bun:test";
import type {
  NormalizedToolCatalog,
  OntologyDocument,
} from "../src/types";
import {
  buildNormalizedCatalog,
} from "../src/normalize/index";
import {
  buildDecisionArtifacts,
  evaluateDependencyCandidates,
  generateDependencyCandidates,
} from "../src/matching";
import type {
  GoldFixture,
} from "../src/matching";

const catalog: NormalizedToolCatalog =
  await buildNormalizedCatalog();

const ontology = (await Bun.file(
  "data/ontology.json",
).json()) as OntologyDocument;

const fixture = (await Bun.file(
  "tests/fixtures/dependency-cases.json",
).json()) as GoldFixture;

const candidates =
  generateDependencyCandidates(
    catalog,
    ontology,
  );

const evaluated =
  evaluateDependencyCandidates(
    candidates,
    catalog,
  );

const artifacts =
  buildDecisionArtifacts(
    evaluated,
    catalog,
    fixture,
  );

describe(
  "decision artifact generation",
  () => {
    test(
      "partitions every candidate exactly once",
      () => {
        const records = [
          ...artifacts.accepted.candidates,
          ...artifacts.uncertain.candidates,
          ...artifacts.rejected.candidates,
        ];

        expect(records.length).toBe(
          candidates.length,
        );

        expect(
          new Set(
            records.map(
              (candidate) => candidate.id,
            ),
          ).size,
        ).toBe(candidates.length);

        expect(
          artifacts.validationReport
            .invariants
            .everyCandidatePartitionedExactlyOnce,
        ).toBe(true);
      },
    );

    test(
      "keeps each decision file sorted and internally consistent",
      () => {
        for (const [
          expectedDecision,
          artifact,
        ] of [
          [
            "ACCEPTED",
            artifacts.accepted,
          ],
          [
            "UNCERTAIN",
            artifacts.uncertain,
          ],
          [
            "REJECTED",
            artifacts.rejected,
          ],
        ] as const) {
          expect(artifact.decision).toBe(
            expectedDecision,
          );

          expect(
            artifact.summary
              .candidateCount,
          ).toBe(
            artifact.candidates.length,
          );

          for (
            let index = 1;
            index <
            artifact.candidates.length;
            index += 1
          ) {
            expect(
              artifact.candidates[
                index - 1
              ].id <
                artifact.candidates[
                  index
                ].id,
            ).toBe(true);
          }
        }

        expect(
          artifacts.validationReport
            .invariants
            .decisionFilesSortedByCandidateId,
        ).toBe(true);
      },
    );

    test(
      "reports perfect recall and rejection on the reviewed fixture",
      () => {
        const gold =
          artifacts.validationReport
            .goldEvaluation;

        expect(gold.totalCases).toBe(50);
        expect(gold.generatedCases).toBe(
          50,
        );

        expect(gold.missingCases).toEqual(
          [],
        );

        expect(gold.positiveCases).toBe(
          20,
        );

        expect(
          gold.positiveAccepted,
        ).toBe(20);

        expect(gold.positiveRecall).toBe(
          1,
        );

        expect(gold.falseNegatives).toEqual(
          [],
        );

        expect(gold.negativeCases).toBe(
          20,
        );

        expect(
          gold.negativeRejected,
        ).toBe(20);

        expect(
          gold.negativeRejectionRate,
        ).toBe(1);

        expect(gold.falsePositives).toEqual(
          [],
        );

        expect(gold.ambiguousCases).toBe(
          10,
        );

        expect(
          gold
            .ambiguousIncorrectlyAccepted,
        ).toEqual([]);
      },
    );

    test(
      "matches every reviewed decision, reason, and workflow flag",
      () => {
        const gold =
          artifacts.validationReport
            .goldEvaluation;

        expect(gold.decisionMatches).toBe(
          50,
        );

        expect(gold.reasonMatches).toBe(
          50,
        );

        expect(gold.flagMatches).toBe(
          50,
        );
      },
    );

    test(
      "reports safety rejection and workflow counts",
      () => {
        const metrics =
          artifacts.validationReport
            .safetyAndWorkflow;

        expect(
          metrics.genericFieldRejections,
        ).toBeGreaterThan(0);

        expect(
          metrics
            .sameInformationRejections,
        ).toBeGreaterThan(0);

        expect(
          metrics.selectionRequired,
        ).toBeGreaterThan(0);

        expect(
          metrics.disambiguationRequired,
        ).toBeGreaterThan(0);

        expect(
          metrics.transformationRequired,
        ).toBeGreaterThan(0);
      },
    );

    test(
      "is deterministic without timestamps or random identifiers",
      () => {
        const second =
          buildDecisionArtifacts(
            evaluated,
            catalog,
            fixture,
          );

        expect(
          JSON.stringify(second),
        ).toBe(
          JSON.stringify(artifacts),
        );
      },
    );
  },
);
