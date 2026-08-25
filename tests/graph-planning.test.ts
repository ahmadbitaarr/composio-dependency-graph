import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  DependencyGraphArtifact,
} from "../src/graph/assemble";
import {
  buildPlanningCatalog,
} from "../src/graph/planning";
import type {
  ToolInputRequirementsArtifact,
} from "../src/graph/requirements";

const graph =
  (await Bun.file(
    "data/dependency-graph.json",
  ).json()) as DependencyGraphArtifact;

const requirements =
  (await Bun.file(
    "data/tool-input-requirements.json",
  ).json()) as ToolInputRequirementsArtifact;

describe(
  "lightweight planning semantics",
  () => {
    test(
      "preserves every required input exactly once",
      () => {
        const planning =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        const plannedInputs =
          planning.toolPlans.flatMap(
            (toolPlan) =>
              toolPlan.requiredInputs,
          );

        expect(
          plannedInputs.length,
        ).toBe(
          requirements
            .requirements.length,
        );

        expect(
          new Set(
            plannedInputs.map(
              (input) =>
                input.requirementId,
            ),
          ).size,
        ).toBe(
          plannedInputs.length,
        );
      },
    );

    test(
      "provides user and prior-context actions for every input",
      () => {
        const planning =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        for (
          const input
          of planning.toolPlans
            .flatMap(
              (toolPlan) =>
                toolPlan
                  .requiredInputs,
            )
        ) {
          expect(
            input.resolutionOptions
              .some(
                (option) =>
                  option.kind ===
                  "ASK_USER",
              ),
          ).toBe(true);

          expect(
            input.resolutionOptions
              .some(
                (option) =>
                  option.kind ===
                  "USE_PRIOR_CONTEXT",
              ),
          ).toBe(true);
        }
      },
    );

    test(
      "maps every tool-output alternative to a precursor action",
      () => {
        const planning =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        const precursorOptions =
          planning.toolPlans
            .flatMap(
              (toolPlan) =>
                toolPlan
                  .requiredInputs,
            )
            .flatMap(
              (input) =>
                input
                  .resolutionOptions,
            )
            .filter(
              (option) =>
                option.kind ===
                "RUN_PRECURSOR_TOOL",
            );

        expect(
          precursorOptions.length,
        ).toBe(
          requirements.summary
            .toolOutputAlternativeCount,
        );

        expect(
          precursorOptions.length,
        ).toBe(
          graph.edges.length,
        );
      },
    );

    test(
      "references valid accepted graph edges",
      () => {
        const planning =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        const edgeById =
          new Map(
            graph.edges.map(
              (edge) => [
                edge.id,
                edge,
              ],
            ),
          );

        for (
          const option
          of planning.toolPlans
            .flatMap(
              (toolPlan) =>
                toolPlan
                  .requiredInputs,
            )
            .flatMap(
              (input) =>
                input
                  .resolutionOptions,
            )
        ) {
          if (
            option.kind !==
            "RUN_PRECURSOR_TOOL"
          ) {
            continue;
          }

          const edge =
            edgeById.get(
              option.edgeId,
            );

          if (!edge) {
            throw new Error(
              `Missing graph edge: ${option.edgeId}`,
            );
          }

          expect(
            option
              .producerOutputNodeId,
          ).toBe(edge.from);

          expect(
            option
              .consumerInputNodeId,
          ).toBe(edge.to);

          expect(
            option
              .precursorToolSlug,
          ).toBe(
            edge.producerTool,
          );

          expect(
            option.targetToolSlug,
          ).toBe(
            edge.consumerTool,
          );
        }
      },
    );

    test(
      "sorts plans and requirements deterministically",
      () => {
        const planning =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        const toolSlugs =
          planning.toolPlans.map(
            (toolPlan) =>
              toolPlan.toolSlug,
          );

        expect(
          toolSlugs,
        ).toEqual(
          [...toolSlugs].sort(),
        );

        for (
          const toolPlan
          of planning.toolPlans
        ) {
          const requirementIds =
            toolPlan.requiredInputs
              .map(
                (input) =>
                  input
                    .requirementId,
              );

          expect(
            requirementIds,
          ).toEqual(
            [
              ...requirementIds,
            ].sort(),
          );
        }
      },
    );

    test(
      "is deterministic",
      () => {
        const first =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        const second =
          buildPlanningCatalog(
            requirements,
            graph,
          );

        expect(first).toEqual(
          second,
        );
      },
    );
  },
);
