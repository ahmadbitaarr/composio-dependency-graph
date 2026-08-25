import type {
  DependencyGraphArtifact,
} from "./assemble";
import {
  buildPlanningCatalog,
} from "./planning";
import type {
  ToolInputRequirementsArtifact,
} from "./requirements";

const [
  graph,
  requirements,
] = await Promise.all([
  Bun.file(
    "data/dependency-graph.json",
  ).json() as Promise<
    DependencyGraphArtifact
  >,
  Bun.file(
    "data/tool-input-requirements.json",
  ).json() as Promise<
    ToolInputRequirementsArtifact
  >,
]);

const planning =
  buildPlanningCatalog(
    requirements,
    graph,
  );

const outputPath =
  "data/tool-planning-catalog.json";

await Bun.write(
  outputPath,
  JSON.stringify(
    planning,
    null,
    2,
  ),
);

console.log({
  format: planning.format,
  toolPlanCount:
    planning.summary
      .toolPlanCount,
  requiredInputCount:
    planning.summary
      .requiredInputCount,
  askUserOptionCount:
    planning.summary
      .askUserOptionCount,
  priorContextOptionCount:
    planning.summary
      .priorContextOptionCount,
  precursorToolOptionCount:
    planning.summary
      .precursorToolOptionCount,
  toolsWithPrecursorOptions:
    planning.summary
      .toolsWithPrecursorOptions,
  inputsWithPrecursorOptions:
    planning.summary
      .inputsWithPrecursorOptions,
  inputsWithoutPrecursorOptions:
    planning.summary
      .inputsWithoutPrecursorOptions,
  networkRequestsMade: false,
  llmRequestsMade: false,
  output: outputPath,
});
