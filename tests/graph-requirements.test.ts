import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  DependencyGraphArtifact,
} from "../src/graph/assemble";
import {
  buildToolInputRequirements,
} from "../src/graph/requirements";
import type {
  DecisionArtifact,
} from "../src/matching";
import type {
  NormalizedToolCatalog,
} from "../src/types";

const catalog =
  (await Bun.file(
    "data/normalized-tools.json",
  ).json()) as NormalizedToolCatalog;

const graph =
  (await Bun.file(
    "data/dependency-graph.json",
  ).json()) as DependencyGraphArtifact;

const uncertain =
  (await Bun.file(
    "data/candidates.uncertain.json",
  ).json()) as DecisionArtifact;

const rejected =
  (await Bun.file(
    "data/candidates.rejected.json",
  ).json()) as DecisionArtifact;

describe(
  "tool input requirements",
  () => {
    test(
      "creates one requirement for every effectively required input field",
      () => {
        const artifact =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        const expectedCount =
          catalog.tools.reduce(
            (
              total,
              tool,
            ) =>
              total +
              tool.inputFields.filter(
                (field) =>
                  field
                    .effectivelyRequired,
              ).length,
            0,
          );

        expect(
          artifact.summary
            .requiredInputCount,
        ).toBe(
          expectedCount,
        );

        expect(
          artifact
            .requirements.length,
        ).toBe(
          expectedCount,
        );
      },
    );

    test(
      "provides USER and PRIOR_CONTEXT for every requirement",
      () => {
        const artifact =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        for (
          const requirement
          of artifact.requirements
        ) {
          expect(
            requirement
              .alternatives.some(
                (alternative) =>
                  alternative.kind ===
                  "USER",
              ),
          ).toBe(true);

          expect(
            requirement
              .alternatives.some(
                (alternative) =>
                  alternative.kind ===
                  "PRIOR_CONTEXT",
              ),
          ).toBe(true);
        }
      },
    );

    test(
      "uses only accepted graph edges as tool-output alternatives",
      () => {
        const artifact =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        const graphEdgeIds =
          new Set(
            graph.edges.map(
              (edge) =>
                edge.id,
            ),
          );

        const uncertainIds =
          new Set(
            uncertain.candidates.map(
              (candidate) =>
                candidate.id,
            ),
          );

        const rejectedIds =
          new Set(
            rejected.candidates.map(
              (candidate) =>
                candidate.id,
            ),
          );

        const toolOutputIds =
          artifact.requirements
            .flatMap(
              (requirement) =>
                requirement
                  .alternatives,
            )
            .filter(
              (
                alternative,
              ): alternative is Extract<
                typeof alternative,
                {
                  kind:
                    "TOOL_OUTPUT";
                }
              > =>
                alternative.kind ===
                "TOOL_OUTPUT",
            )
            .map(
              (alternative) =>
                alternative.edgeId,
            );

        expect(
          toolOutputIds.every(
            (edgeId) =>
              graphEdgeIds.has(
                edgeId,
              ),
          ),
        ).toBe(true);

        expect(
          toolOutputIds.some(
            (edgeId) =>
              uncertainIds.has(
                edgeId,
              ),
          ),
        ).toBe(false);

        expect(
          toolOutputIds.some(
            (edgeId) =>
              rejectedIds.has(
                edgeId,
              ),
          ),
        ).toBe(false);
      },
    );

    test(
      "matches accepted incoming edges for each required input",
      () => {
        const artifact =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        const incomingCounts =
          new Map<
            string,
            number
          >();

        for (
          const edge
          of graph.edges
        ) {
          incomingCounts.set(
            edge.to,
            (
              incomingCounts.get(
                edge.to,
              ) ?? 0
            ) + 1,
          );
        }

        for (
          const requirement
          of artifact.requirements
        ) {
          const actual =
            requirement
              .alternatives
              .filter(
                (alternative) =>
                  alternative.kind ===
                  "TOOL_OUTPUT",
              ).length;

          expect(actual).toBe(
            incomingCounts.get(
              requirement.id,
            ) ?? 0,
          );
        }
      },
    );

    test(
      "sorts requirements and tool-output alternatives deterministically",
      () => {
        const artifact =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        const ids =
          artifact.requirements.map(
            (requirement) =>
              requirement.id,
          );

        expect(ids).toEqual(
          [...ids].sort(),
        );

        for (
          const requirement
          of artifact.requirements
        ) {
          const edgeIds =
            requirement
              .alternatives
              .filter(
                (
                  alternative,
                ): alternative is Extract<
                  typeof alternative,
                  {
                    kind:
                      "TOOL_OUTPUT";
                  }
                > =>
                  alternative.kind ===
                  "TOOL_OUTPUT",
              )
              .map(
                (alternative) =>
                  alternative.edgeId,
              );

          expect(edgeIds).toEqual(
            [...edgeIds].sort(),
          );
        }
      },
    );

    test(
      "is deterministic",
      () => {
        const first =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        const second =
          buildToolInputRequirements(
            catalog,
            graph,
          );

        expect(first).toEqual(
          second,
        );
      },
    );
  },
);
