import { describe, expect, test } from "bun:test";
import type {
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
} from "../src/types";
import { buildNormalizedCatalog } from "../src/normalize/index";

type ExpectedDecision = "ACCEPTED" | "REJECTED" | "UNCERTAIN";
type CaseCategory = "positive" | "negative" | "ambiguous";

type DependencyCase = {
  id: string;
  category: CaseCategory;
  producerTool: string;
  producerOutputPath: string;
  consumerTool: string;
  consumerInputPath: string;
  expectedDecision: ExpectedDecision;
  expectedEntity: string | null;
  expectedReason: string;
  expectedSelectionRequired: boolean;
  expectedTransformationRequired: boolean;
  expectedDisambiguationRequired: boolean;
  notes: string;
};

type DependencyFixture = {
  format: "dependency-evaluation-cases-v1";
  generatedFrom: {
    catalogFormat: string;
    catalogGeneratedAt: string;
    ontologyVersion: string;
    note: string;
  };
  summary: {
    total: number;
    positive: number;
    negative: number;
    ambiguous: number;
    accepted: number;
    rejected: number;
    uncertain: number;
  };
  cases: DependencyCase[];
};

const fixture = (await Bun.file(
  "tests/fixtures/dependency-cases.json",
).json()) as DependencyFixture;

const catalog: NormalizedToolCatalog =
  await buildNormalizedCatalog();

const toolsBySlug = new Map(
  catalog.tools.map((candidate) => [
    candidate.metadata.slug,
    candidate,
  ]),
);

function tool(slug: string): NormalizedTool {
  const found = toolsBySlug.get(slug);

  expect(
    found,
    `Expected normalized tool ${slug}`,
  ).toBeDefined();

  return found!;
}

function field(
  slug: string,
  direction: "input" | "output",
  jsonPath: string,
): NormalizedSchemaField {
  const normalizedTool = tool(slug);

  const fields =
    direction === "input"
      ? normalizedTool.inputFields
      : normalizedTool.outputFields;

  const found = fields.find(
    (candidate) => candidate.jsonPath === jsonPath,
  );

  expect(
    found,
    `Expected ${slug} ${direction} field ${jsonPath}`,
  ).toBeDefined();

  return found!;
}

function entityOf(
  normalizedField: NormalizedSchemaField,
): string | null {
  return (
    normalizedField.canonicalEntity?.entity ??
    null
  );
}

function jsonTypesCompatible(
  producer: NormalizedSchemaField,
  consumer: NormalizedSchemaField,
): boolean {
  const producerTypes = new Set(
    producer.jsonTypes,
  );

  const consumerTypes = new Set(
    consumer.jsonTypes,
  );

  for (const producerType of producerTypes) {
    if (consumerTypes.has(producerType)) {
      return true;
    }

    if (
      producerType === "integer" &&
      consumerTypes.has("number")
    ) {
      return true;
    }

    if (
      producerType === "number" &&
      consumerTypes.has("integer")
    ) {
      return true;
    }
  }

  return false;
}

function casesWithDecision(
  decision: ExpectedDecision,
): DependencyCase[] {
  return fixture.cases.filter(
    (candidate) =>
      candidate.expectedDecision === decision,
  );
}

describe("dependency evaluation fixture", () => {
  test("uses the reviewed fixture contract and exact case counts", () => {
    expect(fixture.format).toBe(
      "dependency-evaluation-cases-v1",
    );

    expect(
      fixture.generatedFrom.catalogFormat,
    ).toBe("normalized-tool-catalog-v1");

    expect(
      fixture.generatedFrom.ontologyVersion,
    ).toBe("1.0.0");

    expect(fixture.cases).toHaveLength(50);

    expect(
      fixture.cases.filter(
        (candidate) =>
          candidate.category === "positive",
      ),
    ).toHaveLength(20);

    expect(
      fixture.cases.filter(
        (candidate) =>
          candidate.category === "negative",
      ),
    ).toHaveLength(20);

    expect(
      fixture.cases.filter(
        (candidate) =>
          candidate.category === "ambiguous",
      ),
    ).toHaveLength(10);

    expect(
      casesWithDecision("ACCEPTED"),
    ).toHaveLength(20);

    expect(
      casesWithDecision("REJECTED"),
    ).toHaveLength(20);

    expect(
      casesWithDecision("UNCERTAIN"),
    ).toHaveLength(10);

    expect(fixture.summary).toEqual({
      total: 50,
      positive: 20,
      negative: 20,
      ambiguous: 10,
      accepted: 20,
      rejected: 20,
      uncertain: 10,
    });
  });

  test("uses unique readable case identifiers", () => {
    const ids = fixture.cases.map(
      (candidate) => candidate.id,
    );

    expect(new Set(ids).size).toBe(
      ids.length,
    );

    for (const candidate of fixture.cases) {
      expect(candidate.id).toMatch(
        /^(P|N|A)\d{2}$/,
      );

      expect(candidate.expectedReason).toMatch(
        /^[A-Z0-9_]+$/,
      );

      if (candidate.category === "positive") {
        expect(candidate.id.startsWith("P")).toBe(
          true,
        );

        expect(
          candidate.expectedDecision,
        ).toBe("ACCEPTED");
      }

      if (candidate.category === "negative") {
        expect(candidate.id.startsWith("N")).toBe(
          true,
        );

        expect(
          candidate.expectedDecision,
        ).toBe("REJECTED");
      }

      if (
        candidate.category === "ambiguous"
      ) {
        expect(candidate.id.startsWith("A")).toBe(
          true,
        );

        expect(
          candidate.expectedDecision,
        ).toBe("UNCERTAIN");
      }
    }
  });

  test("references only real tools and exact schema paths", () => {
    for (const candidate of fixture.cases) {
      field(
        candidate.producerTool,
        "output",
        candidate.producerOutputPath,
      );

      field(
        candidate.consumerTool,
        "input",
        candidate.consumerInputPath,
      );
    }
  });

  test("covers both required toolkits in every decision class", () => {
    for (const decision of [
      "ACCEPTED",
      "REJECTED",
      "UNCERTAIN",
    ] as const) {
      const involvedToolkits = new Set<string>();

      for (
        const candidate of casesWithDecision(
          decision,
        )
      ) {
        involvedToolkits.add(
          tool(candidate.producerTool)
            .metadata.toolkit,
        );

        involvedToolkits.add(
          tool(candidate.consumerTool)
            .metadata.toolkit,
        );
      }

      expect(involvedToolkits.has("googlesuper")).toBe(
        true,
      );

      expect(involvedToolkits.has("github")).toBe(
        true,
      );
    }
  });
});

describe("positive dependency cases", () => {
  test("have safe exact canonical-entity matches", () => {
    for (
      const candidate of casesWithDecision(
        "ACCEPTED",
      )
    ) {
      const producer = field(
        candidate.producerTool,
        "output",
        candidate.producerOutputPath,
      );

      const consumer = field(
        candidate.consumerTool,
        "input",
        candidate.consumerInputPath,
      );

      expect(
        candidate.expectedEntity,
        `${candidate.id} must declare its expected entity`,
      ).not.toBeNull();

      expect(entityOf(producer)).toBe(
        candidate.expectedEntity,
      );

      expect(entityOf(consumer)).toBe(
        candidate.expectedEntity,
      );

      expect(producer.safeForInference).toBe(
        true,
      );

      expect(consumer.safeForInference).toBe(
        true,
      );

      expect(
        jsonTypesCompatible(
          producer,
          consumer,
        ),
      ).toBe(true);

      expect(
        tool(candidate.producerTool)
          .metadata.deprecated,
      ).toBe(false);

      expect(
        candidate.expectedSelectionRequired,
      ).toBe(false);

      expect(
        candidate.expectedTransformationRequired,
      ).toBe(false);

      expect(
        candidate.expectedDisambiguationRequired,
      ).toBe(false);

      expect(candidate.expectedReason).toBe(
        "EXACT_CANONICAL_ENTITY_MATCH",
      );
    }
  });

  test("require producers to add the matched entity", () => {
    for (
      const candidate of casesWithDecision(
        "ACCEPTED",
      )
    ) {
      const producerTool = tool(
        candidate.producerTool,
      );

      const repeatedInput =
        producerTool.inputFields.find(
          (input) =>
            entityOf(input) ===
            candidate.expectedEntity,
        );

      expect(
        repeatedInput,
        `${candidate.id} producer must not require the same entity it claims to discover`,
      ).toBeUndefined();
    }
  });
});

describe("negative dependency cases", () => {
  test("encode explicit hard contradictions or non-useful producers", () => {
    for (
      const candidate of casesWithDecision(
        "REJECTED",
      )
    ) {
      const producer = field(
        candidate.producerTool,
        "output",
        candidate.producerOutputPath,
      );

      const consumer = field(
        candidate.consumerTool,
        "input",
        candidate.consumerInputPath,
      );

      const producerTool = tool(
        candidate.producerTool,
      );

      const consumerTool = tool(
        candidate.consumerTool,
      );

      switch (candidate.expectedReason) {
        case "ENTITY_MISMATCH":
        case "PROTOCOL_IDENTITY_MISMATCH": {
          expect(entityOf(producer)).not.toBeNull();
          expect(entityOf(consumer)).not.toBeNull();

          expect(entityOf(producer)).not.toBe(
            entityOf(consumer),
          );

          break;
        }

        case "SERVICE_MISMATCH": {
          expect(
            producerTool.metadata
              .underlyingService,
          ).not.toBe(
            consumerTool.metadata
              .underlyingService,
          );

          break;
        }

        case "PRODUCER_ADDS_NO_NEW_INFORMATION": {
          expect(
            candidate.expectedEntity,
          ).not.toBeNull();

          expect(entityOf(producer)).toBe(
            candidate.expectedEntity,
          );

          expect(entityOf(consumer)).toBe(
            candidate.expectedEntity,
          );

          const repeatedInput =
            producerTool.inputFields.find(
              (input) =>
                entityOf(input) ===
                candidate.expectedEntity,
            );

          expect(
            repeatedInput,
            `${candidate.id} should require the same entity it returns`,
          ).toBeDefined();

          break;
        }

        case "GENERIC_FIELD_WITHOUT_RESOURCE_EVIDENCE": {
          expect(
            producer.safeForInference,
          ).toBe(false);

          expect(entityOf(producer)).toBeNull();

          break;
        }

        default:
          throw new Error(
            `Unhandled rejection reason ${candidate.expectedReason}`,
          );
      }
    }
  });
});

describe("ambiguous dependency cases", () => {
  test("preserve selection, disambiguation, and transformation requirements", () => {
    for (
      const candidate of casesWithDecision(
        "UNCERTAIN",
      )
    ) {
      const producer = field(
        candidate.producerTool,
        "output",
        candidate.producerOutputPath,
      );

      const consumer = field(
        candidate.consumerTool,
        "input",
        candidate.consumerInputPath,
      );

      expect(
        candidate.expectedSelectionRequired ||
          candidate
            .expectedTransformationRequired ||
          candidate
            .expectedDisambiguationRequired,
      ).toBe(true);

      if (
        candidate.expectedSelectionRequired
      ) {
        expect(producer.arrayDepth).toBeGreaterThan(
          0,
        );
      }

      if (
        candidate.expectedTransformationRequired
      ) {
        expect(
          candidate.expectedReason,
        ).toBe("TRANSFORMATION_REQUIRED");

        expect(
          producer.safeForInference,
        ).toBe(false);
      }

      if (
        candidate.expectedReason ===
        "AMBIGUOUS_ISSUE_PULL_REQUEST_NUMBER"
      ) {
        expect(entityOf(producer)).toBeNull();

        expect(entityOf(consumer)).toBe(
          "github.issue_number",
        );
      }

      if (
        candidate.expectedEntity &&
        producer.safeForInference &&
        consumer.safeForInference
      ) {
        expect(entityOf(producer)).toBe(
          candidate.expectedEntity,
        );

        expect(entityOf(consumer)).toBe(
          candidate.expectedEntity,
        );

        expect(
          jsonTypesCompatible(
            producer,
            consumer,
          ),
        ).toBe(true);
      }
    }
  });
});