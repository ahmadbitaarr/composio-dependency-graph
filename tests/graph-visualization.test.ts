import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  DependencyGraphArtifact,
} from "../src/graph/assemble";
import {
  buildToolVisualization,
} from "../src/graph/visualization";

const graph =
  (await Bun.file(
    "data/dependency-graph.json",
  ).json()) as DependencyGraphArtifact;

describe(
  "dependency graph visualization",
  () => {
    test(
      "includes every participating tool",
      () => {
        const visualization =
          buildToolVisualization(
            graph,
          );

        expect(
          visualization.summary
            .toolNodeCount,
        ).toBe(
          graph.summary
            .participatingToolCount,
        );

        expect(
          visualization.nodes
            .length,
        ).toBe(
          graph.summary
            .participatingToolCount,
        );
      },
    );

    test(
      "preserves all accepted field edges through aggregation",
      () => {
        const visualization =
          buildToolVisualization(
            graph,
          );

        expect(
          visualization.summary
            .acceptedFieldEdgeCount,
        ).toBe(
          graph.edges.length,
        );

        expect(
          visualization.summary
            .acceptedFieldEdgeCount,
        ).toBe(6456);
      },
    );

    test(
      "references valid tool nodes",
      () => {
        const visualization =
          buildToolVisualization(
            graph,
          );

        const nodeIds =
          new Set(
            visualization.nodes.map(
              (node) => node.id,
            ),
          );

        for (
          const edge
          of visualization.edges
        ) {
          expect(
            nodeIds.has(edge.from),
          ).toBe(true);

          expect(
            nodeIds.has(edge.to),
          ).toBe(true);
        }
      },
    );

    test(
      "sorts nodes and edges deterministically",
      () => {
        const visualization =
          buildToolVisualization(
            graph,
          );

        const nodeIds =
          visualization.nodes.map(
            (node) => node.id,
          );

        const edgeIds =
          visualization.edges.map(
            (edge) => edge.id,
          );

        expect(nodeIds).toEqual(
          [...nodeIds].sort(),
        );

        expect(edgeIds).toEqual(
          [...edgeIds].sort(),
        );
      },
    );

    test(
      "is deterministic",
      () => {
        const first =
          buildToolVisualization(
            graph,
          );

        const second =
          buildToolVisualization(
            graph,
          );

        expect(first).toEqual(
          second,
        );
      },
    );
  },
);
