import type {
  DecisionArtifact,
} from "../matching";
import {
  assembleDependencyGraph,
} from "./assemble";

const accepted =
  (await Bun.file(
    "data/candidates.accepted.json",
  ).json()) as DecisionArtifact;

const graph =
  assembleDependencyGraph(
    accepted,
  );

const outputPath =
  "data/dependency-graph.json";

await Bun.write(
  outputPath,
  JSON.stringify(
    graph,
    null,
    2,
  ),
);

console.log({
  format: graph.format,
  nodeCount:
    graph.summary.nodeCount,
  edgeCount:
    graph.summary.edgeCount,
  participatingToolCount:
    graph.summary
      .participatingToolCount,
  producerNodeCount:
    graph.summary
      .producerNodeCount,
  consumerNodeCount:
    graph.summary
      .consumerNodeCount,
  selectionRequiredEdges:
    graph.summary
      .selectionRequiredEdges,
  transformationRequiredEdges:
    graph.summary
      .transformationRequiredEdges,
  disambiguationRequiredEdges:
    graph.summary
      .disambiguationRequiredEdges,
  networkRequestsMade: false,
  llmRequestsMade: false,
  output: outputPath,
});
