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
  generateDependencyCandidates,
  jsonTypesCompatible,
} from "../src/matching";

type FixtureCase = {
  id: string;
  producerTool: string;
  producerOutputPath: string;
  consumerTool: string;
  consumerInputPath: string;
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

function fixtureCase(
  id: string,
): FixtureCase {
  const found = fixture.cases.find(
    (candidate) => candidate.id === id,
  );

  expect(
    found,
    `Expected fixture case ${id}`,
  ).toBeDefined();

  return found!;
}

function generatedCase(id: string) {
  const candidate = fixtureCase(id);

  const found = candidateByPair.get(
    pairKey(
      candidate.producerTool,
      candidate.producerOutputPath,
      candidate.consumerTool,
      candidate.consumerInputPath,
    ),
  );

  expect(
    found,
    `Expected generated candidate for ${id}`,
  ).toBeDefined();

  return found!;
}

describe(
  "deterministic candidate generation",
  () => {
    test(
      "produces unique ordered candidate IDs without combinatorial growth",
      () => {
        const orderingErrors: string[] = [];

        for (
          let index = 1;
          index < candidates.length;
          index += 1
        ) {
          if (
            candidates[index - 1].id >
            candidates[index].id
          ) {
            orderingErrors.push(
              `${candidates[index - 1].id} > ${candidates[index].id}`,
            );
          }
        }

        expect(
          orderingErrors.slice(0, 10),
        ).toEqual([]);

        expect(
          new Set(
            candidates.map(
              (candidate) => candidate.id,
            ),
          ).size,
        ).toBe(candidates.length);

        expect(
          candidates.length,
        ).toBeGreaterThan(0);

        expect(
          candidates.length,
        ).toBeLessThan(250_000);
      },
    );

    test(
      "is stable on the reviewed fixture surface",
      () => {
        const reviewedSlugs = new Set(
          fixture.cases.flatMap(
            (candidate) => [
              candidate.producerTool,
              candidate.consumerTool,
            ],
          ),
        );

        const reviewedCatalog = {
          ...catalog,
          tools: catalog.tools.filter(
            (tool) =>
              reviewedSlugs.has(
                tool.metadata.slug,
              ),
          ),
        };

        const first =
          generateDependencyCandidates(
            reviewedCatalog,
            ontology,
          ).map(
            (candidate) => candidate.id,
          );

        const second =
          generateDependencyCandidates(
            reviewedCatalog,
            ontology,
          ).map(
            (candidate) => candidate.id,
          );

        expect(second).toEqual(first);
      },
    );

    test(
      "generates all reviewed gold fixture pairs",
      () => {
        const missing =
          fixture.cases.filter(
            (candidate) =>
              !candidateByPair.has(
                pairKey(
                  candidate.producerTool,
                  candidate
                    .producerOutputPath,
                  candidate.consumerTool,
                  candidate
                    .consumerInputPath,
                ),
              ),
          );

        expect(missing).toEqual([]);
      },
    );

    test(
      "uses canonical indexes for exact matches",
      () => {
        const candidate =
          generatedCase("P01");

        expect(
          candidate.generationReasons,
        ).toContain(
          "EXACT_CANONICAL_ENTITY",
        );

        expect(
          candidate
            .matchedCanonicalEntity,
        ).toBe("gmail.thread_id");
      },
    );

    test(
      "uses ontology hard separations for contradictions",
      () => {
        const candidate =
          generatedCase("N01");

        expect(
          candidate.generationReasons,
        ).toContain(
          "HARD_SEPARATION_PAIR",
        );

        expect(
          candidate.hardSeparation,
        ).not.toBeNull();
      },
    );

    test(
      "retains workflow-run versus job contradictions",
      () => {
        const candidate =
          generatedCase("N11");

        expect(
          candidate.generationReasons,
        ).toContain(
          "HARD_SEPARATION_PAIR",
        );

        expect(
          candidate.producer
            .canonicalEntity,
        ).toBe(
          "github.workflow_run_id",
        );

        expect(
          candidate.consumer
            .canonicalEntity,
        ).toBe("github.job_id");
      },
    );

    test(
      "retains REST versus GraphQL identity contradictions even when JSON types differ",
      () => {
        const candidate =
          generatedCase("N13");

        expect(
          candidate.generationReasons,
        ).toContain(
          "HARD_SEPARATION_PAIR",
        );

        expect(
          candidate.producer
            .canonicalEntity,
        ).toBe(
          "github.repository_node_id",
        );

        expect(
          candidate.consumer
            .canonicalEntity,
        ).toBe(
          "github.repository_id",
        );
      },
    );

    test(
      "retains collection-derived job candidates for selection",
      () => {
        const candidate =
          generatedCase("A07");

        expect(
          candidate.generationReasons,
        ).toContain(
          "EXACT_CANONICAL_ENTITY",
        );

        expect(
          candidate.producer.arrayDepth,
        ).toBeGreaterThan(0);

        expect(
          candidate.consumer
            .canonicalEntity,
        ).toBe("github.job_id");
      },
    );

    test(
      "retains unsafe generic identity candidates for rejection",
      () => {
        const candidate =
          generatedCase("N20");

        expect(
          candidate.generationReasons,
        ).toContain(
          "GENERIC_IDENTITY_FIELD",
        );

        expect(
          candidate.producer
            .safeForInference,
        ).toBe(false);

        expect(
          candidate.producer
            .canonicalEntity,
        ).toBeNull();
      },
    );

    test(
      "retains contact email recipient disambiguation",
      () => {
        const candidate =
          generatedCase("A04");

        expect(
          candidate.generationReasons,
        ).toContain(
          "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
        );

        expect(
          candidate.producer
            .canonicalEntity,
        ).toBe(
          "google.contact_email",
        );

        expect(
          candidate.consumer
            .canonicalEntity,
        ).toBeNull();
      },
    );

    test(
      "retains explicit repository transformations",
      () => {
        const candidate =
          generatedCase("A09");

        expect(
          candidate.generationReasons,
        ).toContain(
          "REPOSITORY_FULL_NAME_TRANSFORMATION",
        );

        expect(
          candidate.producer
            .canonicalEntity,
        ).toBeNull();
      },
    );

    test(
      "retains issue and pull-request ambiguity",
      () => {
        const candidate =
          generatedCase("A10");

        expect(
          candidate.generationReasons,
        ).toContain(
          "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
        );

        expect(
          candidate.producer
            .canonicalEntity,
        ).toBeNull();
      },
    );

    test("does not generate issue ambiguity from milestone numbers", () => {
      const milestoneCandidates = candidates.filter(
        (candidate) =>
          candidate.producer.toolSlug ===
            "GITHUB_CREATE_A_MILESTONE" &&
          candidate.producer.path ===
            "$.data.number" &&
          candidate.generationReasons.includes(
            "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
          ),
      );

      expect(milestoneCandidates).toEqual([]);
    });

    test(
      "emits only justified scalar candidates",
      () => {
        const tools = new Map(
          catalog.tools.map((tool) => [
            tool.metadata.slug,
            tool,
          ]),
        );

        const errors: string[] = [];

        for (
          const candidate of candidates
        ) {
          const producerTool =
            tools.get(
              candidate.producer
                .toolSlug,
            );

          const consumerTool =
            tools.get(
              candidate.consumer
                .toolSlug,
            );

          const producer =
            producerTool
              ?.outputFields.find(
                (field) =>
                  field.jsonPath ===
                  candidate.producer.path,
              );

          const consumer =
            consumerTool
              ?.inputFields.find(
                (field) =>
                  field.jsonPath ===
                  candidate.consumer.path,
              );

          if (
            !producerTool ||
            !consumerTool ||
            !producer ||
            !consumer
          ) {
            errors.push(
              `Missing endpoint for ${candidate.id}`,
            );
            continue;
          }

          const compatible =
            jsonTypesCompatible(
              producer,
              consumer,
            );

          const isHardSeparation =
            candidate
              .generationReasons
              .includes(
                "HARD_SEPARATION_PAIR",
              );

          if (
            !compatible &&
            !isHardSeparation
          ) {
            errors.push(
              `Type-incompatible non-separation candidate ${candidate.id}`,
            );
          }

          const consumerIsCanonical =
            consumer.canonicalEntity !==
            undefined;

          const contactRecipient =
            candidate
              .generationReasons
              .includes(
                "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
              );

          if (
            !consumerIsCanonical &&
            !contactRecipient
          ) {
            errors.push(
              `Unclassified consumer without an explicit disambiguation rule ${candidate.id}`,
            );
          }
        }

        expect(
          errors.slice(0, 20),
        ).toEqual([]);
      },
    );

    test(
      "covers both required toolkits",
      () => {
        const toolkits = new Set(
          candidates.flatMap(
            (candidate) => [
              candidate.producer
                .toolkit,
              candidate.consumer
                .toolkit,
            ],
          ),
        );

        expect(
          toolkits.has("googlesuper"),
        ).toBe(true);

        expect(
          toolkits.has("github"),
        ).toBe(true);
      },
    );
  },
);
