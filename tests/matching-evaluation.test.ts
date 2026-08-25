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
  createEvaluationContext,
  evaluateDependencyCandidate,
  generateDependencyCandidates,
} from "../src/matching";

type FixtureCase = {
  id: string;
  producerTool: string;
  producerOutputPath: string;
  consumerTool: string;
  consumerInputPath: string;
  expectedDecision:
    | "ACCEPTED"
    | "UNCERTAIN"
    | "REJECTED";
  expectedReason: string;
  expectedSelectionRequired: boolean;
  expectedTransformationRequired: boolean;
  expectedDisambiguationRequired: boolean;
};

type Fixture = {
  cases: FixtureCase[];
};

const catalog: NormalizedToolCatalog =
  await buildNormalizedCatalog();

const ontology = (await Bun.file(
  "data/ontology.json",
).json()) as OntologyDocument;

const fixture = (await Bun.file(
  "tests/fixtures/dependency-cases.json",
).json()) as Fixture;

const candidates =
  generateDependencyCandidates(
    catalog,
    ontology,
  );

const context =
  createEvaluationContext(catalog);

function pairKey(
  producerTool: string,
  producerPath: string,
  consumerTool: string,
  consumerPath: string,
): string {
  return [
    producerTool,
    producerPath,
    consumerTool,
    consumerPath,
  ].join("|");
}

const candidateByPair = new Map(
  candidates.map((candidate) => [
    pairKey(
      candidate.producer.toolSlug,
      candidate.producer.path,
      candidate.consumer.toolSlug,
      candidate.consumer.path,
    ),
    candidate,
  ]),
);

const evaluatedFixture = fixture.cases.map(
  (expected) => {
    const candidate = candidateByPair.get(
      pairKey(
        expected.producerTool,
        expected.producerOutputPath,
        expected.consumerTool,
        expected.consumerInputPath,
      ),
    );

    expect(
      candidate,
      `Expected generated candidate ${expected.id}`,
    ).toBeDefined();

    return {
      expected,
      evaluation:
        evaluateDependencyCandidate(
          candidate!,
          context,
        ),
    };
  },
);

describe(
  "deterministic candidate evaluation",
  () => {
    test(
      "matches every reviewed gold decision and primary reason",
      () => {
        const differences =
          evaluatedFixture.flatMap(
            ({ expected, evaluation }) => {
              const errors: string[] = [];

              if (
                evaluation.decision !==
                expected.expectedDecision
              ) {
                errors.push(
                  `${expected.id}: decision ${evaluation.decision} != ${expected.expectedDecision}`,
                );
              }

              if (
                evaluation.primaryReason !==
                expected.expectedReason
              ) {
                errors.push(
                  `${expected.id}: reason ${evaluation.primaryReason} != ${expected.expectedReason}`,
                );
              }

              return errors;
            },
          );

        expect(differences).toEqual([]);
      },
    );

    test(
      "matches every reviewed selection, transformation, and disambiguation flag",
      () => {
        const differences =
          evaluatedFixture.flatMap(
            ({ expected, evaluation }) => {
              const errors: string[] = [];

              if (
                evaluation.selectionRequired !==
                expected.expectedSelectionRequired
              ) {
                errors.push(
                  `${expected.id}: selection flag mismatch`,
                );
              }

              if (
                evaluation.transformationRequired !==
                expected.expectedTransformationRequired
              ) {
                errors.push(
                  `${expected.id}: transformation flag mismatch`,
                );
              }

              if (
                evaluation.disambiguationRequired !==
                expected.expectedDisambiguationRequired
              ) {
                errors.push(
                  `${expected.id}: disambiguation flag mismatch`,
                );
              }

              return errors;
            },
          );

        expect(differences).toEqual([]);
      },
    );

    test(
      "produces the reviewed 20 accepted, 20 rejected, and 10 uncertain split",
      () => {
        const counts = {
          ACCEPTED: 0,
          REJECTED: 0,
          UNCERTAIN: 0,
        };

        for (
          const { evaluation } of
          evaluatedFixture
        ) {
          counts[evaluation.decision] += 1;
        }

        expect(counts).toEqual({
          ACCEPTED: 20,
          REJECTED: 20,
          UNCERTAIN: 10,
        });
      },
    );

    test(
      "accepts only safe scalar exact matches that add new information",
      () => {
        const errors: string[] = [];

        for (
          const {
            expected,
            evaluation,
          } of evaluatedFixture
        ) {
          if (
            evaluation.decision !==
            "ACCEPTED"
          ) {
            continue;
          }

          if (
            !evaluation.checks
              .entityCompatible ||
            !evaluation.checks
              .typeCompatible ||
            !evaluation.checks
              .serviceCompatible ||
            !evaluation.checks
              .producerSafeForInference ||
            !evaluation.checks
              .producerAddsNewInformation
          ) {
            errors.push(
              `${expected.id}: unsafe accepted candidate`,
            );
          }
        }

        expect(errors).toEqual([]);
      },
    );

    test(
      "rejects hard separations before collection or type heuristics",
      () => {
        for (const id of [
          "N09",
          "N11",
          "N12",
          "N13",
        ]) {
          const found =
            evaluatedFixture.find(
              ({ expected }) =>
                expected.id === id,
            );

          expect(found).toBeDefined();
          expect(
            found!.evaluation.decision,
          ).toBe("REJECTED");
        }
      },
    );

    test(
      "detects producers that require the identifier they return",
      () => {
        for (const id of [
          "N18",
          "N19",
        ]) {
          const found =
            evaluatedFixture.find(
              ({ expected }) =>
                expected.id === id,
            );

          expect(found).toBeDefined();

          expect(
            found!.evaluation
              .primaryReason,
          ).toBe(
            "PRODUCER_ADDS_NO_NEW_INFORMATION",
          );

          expect(
            found!.evaluation.checks
              .producerAddsNewInformation,
          ).toBe(false);
        }
      },
    );

    test(
      "records deterministic scope diagnostics without guessing runtime values",
      () => {
        const allowed = new Set([
          "SHARED_REQUIRED_CONTEXT",
          "NO_REQUIRED_CONTEXT",
          "CONTEXT_NOT_SHARED",
        ]);

        for (
          const { evaluation } of
          evaluatedFixture
        ) {
          expect(
            allowed.has(
              evaluation.checks
                .scopeStatus,
            ),
          ).toBe(true);

          expect(
            evaluation.reasonCodes,
          ).toContain(
            `SCOPE_${evaluation.checks.scopeStatus}`,
          );
        }
      },
    );

    test(
      "is deterministic for every reviewed case",
      () => {
        const first =
          evaluatedFixture.map(
            ({ evaluation }) =>
              JSON.stringify(evaluation),
          );

        const second =
          fixture.cases.map(
            (expected) => {
              const candidate =
                candidateByPair.get(
                  pairKey(
                    expected.producerTool,
                    expected
                      .producerOutputPath,
                    expected.consumerTool,
                    expected
                      .consumerInputPath,
                  ),
                )!;

              return JSON.stringify(
                evaluateDependencyCandidate(
                  candidate,
                  context,
                ),
              );
            },
          );

        expect(second).toEqual(first);
      },
    );
  },
);
