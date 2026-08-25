import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  resolve,
} from "node:path";

type HoldoutDecision =
  | "ACCEPT"
  | "REJECT"
  | "ABSTAIN";

type DependencyKind =
  | "LOOKUP"
  | "RESOLVER"
  | "CREATOR"
  | "TRANSFORMATION"
  | "UNKNOWN";

type HoldoutCase = {
  id: string;
  candidateId: string;
  toolkit: "github" | "googlesuper";
  sourcePrimaryReason: string;
  expectedDecision: HoldoutDecision;
  expectedDependencyKind: DependencyKind;
  expectedSelectionRequired: boolean;
  expectedDisambiguationRequired: boolean;
  expectedTransformationRequired: boolean;
  rationale: string;
};

type HoldoutFixture = {
  format: "adjudication-holdout-v1";
  generatedFrom: {
    poolFormat: string;
    uncertainArtifactFormat: string;
    uncertainCandidateCount: number;
    catalogFormat: string;
    catalogToolCount: number;
    toolkitVersions: Record<string, string>;
    phase3FixtureFormat: string;
    exactPhase3CandidateOverlapCount: number;
    excludedOverlappingCandidateId: string;
    replacementCandidateId: string;
    reviewPolicy: string;
  };
  summary: {
    total: number;
    github: number;
    googlesuper: number;
    accept: number;
    reject: number;
    abstain: number;
    selectionRequired: number;
    disambiguationRequired: number;
    transformationRequired: number;
  };
  cases: HoldoutCase[];
};

type Endpoint = {
  toolSlug: string;
  fieldId: string;
  path: string;
  arrayDepth: number;
  toolkit: string;
};

type UncertainCandidate = {
  id: string;
  producer: Endpoint;
  consumer: Endpoint;
  primaryReason: string;
  selectionRequired: boolean;
  disambiguationRequired: boolean;
  transformationRequired: boolean;
};

type UncertainArtifact = {
  format: string;
  summary: {
    candidateCount: number;
  };
  candidates: UncertainCandidate[];
};

type Phase3Case = {
  producerTool: string;
  producerOutputPath: string;
  consumerTool: string;
  consumerInputPath: string;
};

type Phase3Fixture = {
  format: string;
  cases: Phase3Case[];
};

type CatalogField = {
  fieldId: string;
  jsonPath: string;
};

type CatalogTool = {
  metadata: {
    slug: string;
    toolkit: string;
  };
  inputFields: CatalogField[];
  outputFields: CatalogField[];
};

type Catalog = {
  format: string;
  tools: CatalogTool[];
};

const fixture = await Bun.file(
  resolve(
    import.meta.dir,
    "fixtures/adjudication-holdout.json",
  ),
).json() as HoldoutFixture;

const uncertain = await Bun.file(
  resolve(
    import.meta.dir,
    "../data/candidates.uncertain.json",
  ),
).json() as UncertainArtifact;

const catalog = await Bun.file(
  resolve(
    import.meta.dir,
    "../data/normalized-tools.json",
  ),
).json() as Catalog;

const phase3Fixture = await Bun.file(
  resolve(
    import.meta.dir,
    "fixtures/dependency-cases.json",
  ),
).json() as Phase3Fixture;

const uncertainById = new Map(
  uncertain.candidates.map((candidate) => [
    candidate.id,
    candidate,
  ]),
);

const toolsBySlug = new Map(
  catalog.tools.map((tool) => [
    tool.metadata.slug,
    tool,
  ]),
);

function phase3CandidateId(
  testCase: Phase3Case,
): string {
  return [
    `${testCase.producerTool}:output:${testCase.producerOutputPath}`,
    `${testCase.consumerTool}:input:${testCase.consumerInputPath}`,
  ].join("=>");
}

function countByDecision(
  decision: HoldoutDecision,
): number {
  return fixture.cases.filter(
    (testCase) =>
      testCase.expectedDecision === decision,
  ).length;
}

function countByToolkit(
  toolkit: "github" | "googlesuper",
): number {
  return fixture.cases.filter(
    (testCase) =>
      testCase.toolkit === toolkit,
  ).length;
}

describe(
  "independent adjudication holdout",
  () => {
    test(
      "uses the reviewed contract and exact counts",
      () => {
        expect(fixture.format).toBe(
          "adjudication-holdout-v1",
        );

        expect(fixture.cases).toHaveLength(40);
        expect(fixture.summary.total).toBe(40);

        expect(
          countByToolkit("github"),
        ).toBe(20);

        expect(
          countByToolkit("googlesuper"),
        ).toBe(20);

        expect(
          countByDecision("ACCEPT"),
        ).toBe(29);

        expect(
          countByDecision("REJECT"),
        ).toBe(4);

        expect(
          countByDecision("ABSTAIN"),
        ).toBe(7);

        expect(fixture.summary.github).toBe(20);
        expect(fixture.summary.googlesuper).toBe(20);
        expect(fixture.summary.accept).toBe(29);
        expect(fixture.summary.reject).toBe(4);
        expect(fixture.summary.abstain).toBe(7);
      },
    );

    test(
      "uses unique readable case and candidate identifiers",
      () => {
        const caseIds = fixture.cases.map(
          (testCase) => testCase.id,
        );

        const candidateIds = fixture.cases.map(
          (testCase) => testCase.candidateId,
        );

        expect(new Set(caseIds).size).toBe(
          caseIds.length,
        );

        expect(new Set(candidateIds).size).toBe(
          candidateIds.length,
        );

        for (
          let index = 0;
          index < fixture.cases.length;
          index += 1
        ) {
          expect(
            fixture.cases[index]?.id,
          ).toBe(
            `H${String(index + 1).padStart(2, "0")}`,
          );
        }
      },
    );

    test(
      "has no exact candidate overlap with the Phase 3 fixture",
      () => {
        const phase3Ids = new Set(
          phase3Fixture.cases.map(
            phase3CandidateId,
          ),
        );

        const overlap = fixture.cases
          .map(
            (testCase) =>
              testCase.candidateId,
          )
          .filter((candidateId) =>
            phase3Ids.has(candidateId),
          )
          .sort();

        expect(overlap).toEqual([]);

        expect(
          fixture.generatedFrom
            .exactPhase3CandidateOverlapCount,
        ).toBe(0);

        expect(
          fixture.cases.some(
            (testCase) =>
              testCase.candidateId ===
              fixture.generatedFrom
                .excludedOverlappingCandidateId,
          ),
        ).toBe(false);

        expect(
          fixture.cases.some(
            (testCase) =>
              testCase.candidateId ===
              fixture.generatedFrom
                .replacementCandidateId,
          ),
        ).toBe(true);
      },
    );

    test(
      "references only current real uncertain candidates",
      () => {
        expect(uncertain.format).toBe(
          fixture.generatedFrom
            .uncertainArtifactFormat,
        );

        expect(
          uncertain.summary.candidateCount,
        ).toBe(
          fixture.generatedFrom
            .uncertainCandidateCount,
        );

        for (const testCase of fixture.cases) {
          const candidate =
            uncertainById.get(
              testCase.candidateId,
            );

          expect(candidate).toBeDefined();

          expect(
            candidate?.primaryReason,
          ).toBe(
            testCase.sourcePrimaryReason,
          );

          expect(
            candidate?.producer.toolkit,
          ).toBe(testCase.toolkit);
        }
      },
    );

    test(
      "references exact real tools and field paths",
      () => {
        expect(catalog.format).toBe(
          fixture.generatedFrom
            .catalogFormat,
        );

        for (const testCase of fixture.cases) {
          const candidate =
            uncertainById.get(
              testCase.candidateId,
            )!;

          const producerTool =
            toolsBySlug.get(
              candidate.producer.toolSlug,
            );

          const consumerTool =
            toolsBySlug.get(
              candidate.consumer.toolSlug,
            );

          expect(producerTool).toBeDefined();
          expect(consumerTool).toBeDefined();

          const producerField =
            producerTool?.outputFields.find(
              (field) =>
                field.fieldId ===
                  candidate.producer.fieldId &&
                field.jsonPath ===
                  candidate.producer.path,
            );

          const consumerField =
            consumerTool?.inputFields.find(
              (field) =>
                field.fieldId ===
                  candidate.consumer.fieldId &&
                field.jsonPath ===
                  candidate.consumer.path,
            );

          expect(producerField).toBeDefined();
          expect(consumerField).toBeDefined();
        }
      },
    );

    test(
      "preserves reviewed workflow requirements",
      () => {
        const selectionCount =
          fixture.cases.filter(
            (testCase) =>
              testCase
                .expectedSelectionRequired,
          ).length;

        const disambiguationCount =
          fixture.cases.filter(
            (testCase) =>
              testCase
                .expectedDisambiguationRequired,
          ).length;

        const transformationCount =
          fixture.cases.filter(
            (testCase) =>
              testCase
                .expectedTransformationRequired,
          ).length;

        expect(selectionCount).toBe(
          fixture.summary.selectionRequired,
        );

        expect(disambiguationCount).toBe(
          fixture.summary
            .disambiguationRequired,
        );

        expect(transformationCount).toBe(
          fixture.summary
            .transformationRequired,
        );

        for (const testCase of fixture.cases) {
          const candidate =
            uncertainById.get(
              testCase.candidateId,
            )!;

          if (
            testCase
              .expectedSelectionRequired
          ) {
            expect(
              candidate.producer.arrayDepth,
            ).toBeGreaterThan(0);
          }

          if (
            testCase
              .expectedTransformationRequired
          ) {
            expect(
              testCase
                .expectedDependencyKind,
            ).toBe("TRANSFORMATION");

            expect(
              candidate.primaryReason,
            ).toBe(
              "TRANSFORMATION_REQUIRED",
            );
          }

          if (
            testCase
              .expectedDecision ===
              "ABSTAIN"
          ) {
            expect(
              testCase
                .expectedDisambiguationRequired,
            ).toBe(true);
          }
        }
      },
    );

    test(
      "contains manually justified outcomes",
      () => {
        const allowedKinds =
          new Set<DependencyKind>([
            "LOOKUP",
            "RESOLVER",
            "CREATOR",
            "TRANSFORMATION",
            "UNKNOWN",
          ]);

        for (const testCase of fixture.cases) {
          expect(
            allowedKinds.has(
              testCase
                .expectedDependencyKind,
            ),
          ).toBe(true);

          expect(
            testCase.rationale.trim().length,
          ).toBeGreaterThanOrEqual(40);

          if (
            testCase
              .expectedDecision ===
              "REJECT"
          ) {
            expect(
              testCase
                .expectedDependencyKind,
            ).toBe("UNKNOWN");
          }
        }
      },
    );

    test(
      "records immutable toolkit provenance",
      () => {
        expect(
          fixture.generatedFrom
            .toolkitVersions,
        ).toEqual({
          github: "20260713_00",
          googlesuper: "20260714_00",
        });

        expect(
          fixture.generatedFrom
            .reviewPolicy,
        ).toContain("stored tool and field evidence");

        expect(
          fixture.generatedFrom
            .reviewPolicy,
        ).toContain("ABSTAIN");
      },
    );
  },
);