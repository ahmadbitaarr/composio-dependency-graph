import {
  describe,
  expect,
  test,
} from "bun:test";

import {
  assembleDependencyGraph,
} from "../src/graph/assemble";
import type {
  DecisionArtifact,
} from "../src/matching";

const accepted =
  (await Bun.file(
    "data/candidates.accepted.json",
  ).json()) as DecisionArtifact;

const uncertain =
  (await Bun.file(
    "data/candidates.uncertain.json",
  ).json()) as DecisionArtifact;

const rejected =
  (await Bun.file(
    "data/candidates.rejected.json",
  ).json()) as DecisionArtifact;

describe(
  "deterministic graph assembly",
  () => {
    test(
      "creates exactly one edge per accepted candidate",
      () => {
        const graph =
          assembleDependencyGraph(
            accepted,
          );

        expect(
          accepted.candidates
            .length,
        ).toBe(6456);

        expect(
          graph.summary
            .edgeCount,
        ).toBe(6456);

        expect(
          graph.edges.length,
        ).toBe(6456);

        expect(
          graph.generatedFrom
            .acceptedCandidateCount,
        ).toBe(6456);
      },
    );

    test(
      "uses unique parameter nodes and valid edge endpoints",
      () => {
        const graph =
          assembleDependencyGraph(
            accepted,
          );

        const nodeById =
          new Map(
            graph.nodes.map(
              (node) => [
                node.id,
                node,
              ],
            ),
          );

        expect(
          nodeById.size,
        ).toBe(
          graph.nodes.length,
        );

        for (
          const edge
          of graph.edges
        ) {
          expect(
            nodeById.get(
              edge.from,
            )?.direction,
          ).toBe("output");

          expect(
            nodeById.get(
              edge.to,
            )?.direction,
          ).toBe("input");
        }
      },
    );

    test(
      "preserves every accepted candidate ID",
      () => {
        const graph =
          assembleDependencyGraph(
            accepted,
          );

        expect(
          graph.edges.map(
            (edge) => edge.id,
          ),
        ).toEqual(
          accepted.candidates.map(
            (candidate) =>
              candidate.id,
          ),
        );
      },
    );

    test(
      "does not include uncertain or rejected candidates",
      () => {
        const graph =
          assembleDependencyGraph(
            accepted,
          );

        const graphIds =
          new Set(
            graph.edges.map(
              (edge) =>
                edge.id,
            ),
          );

        for (
          const candidate
          of uncertain.candidates
        ) {
          expect(
            graphIds.has(
              candidate.id,
            ),
          ).toBe(false);
        }

        for (
          const candidate
          of rejected.candidates
        ) {
          expect(
            graphIds.has(
              candidate.id,
            ),
          ).toBe(false);
        }
      },
    );

    test(
      "sorts nodes and edges deterministically",
      () => {
        const graph =
          assembleDependencyGraph(
            accepted,
          );

        const sortedNodeIds = [
          ...graph.nodes.map(
            (node) => node.id,
          ),
        ].sort();

        const sortedEdgeIds = [
          ...graph.edges.map(
            (edge) => edge.id,
          ),
        ].sort();

        expect(
          graph.nodes.map(
            (node) => node.id,
          ),
        ).toEqual(
          sortedNodeIds,
        );

        expect(
          graph.edges.map(
            (edge) => edge.id,
          ),
        ).toEqual(
          sortedEdgeIds,
        );
      },
    );

    test(
      "does not mutate the accepted artifact",
      () => {
        const before =
          JSON.stringify(
            accepted,
          );

        assembleDependencyGraph(
          accepted,
        );

        expect(
          JSON.stringify(
            accepted,
          ),
        ).toBe(before);
      },
    );

    test(
      "is deterministic for identical inputs",
      () => {
        const first =
          assembleDependencyGraph(
            accepted,
          );

        const second =
          assembleDependencyGraph(
            accepted,
          );

        expect(first).toEqual(
          second,
        );
      },
    );
  },
);
