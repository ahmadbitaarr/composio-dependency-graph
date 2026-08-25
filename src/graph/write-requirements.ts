import type {
  DependencyGraphArtifact,
} from "./assemble";
import {
  buildToolInputRequirements,
} from "./requirements";
import type {
  NormalizedToolCatalog,
} from "../types";

const [
  catalog,
  graph,
] = await Promise.all([
  Bun.file(
    "data/normalized-tools.json",
  ).json() as Promise<
    NormalizedToolCatalog
  >,
  Bun.file(
    "data/dependency-graph.json",
  ).json() as Promise<
    DependencyGraphArtifact
  >,
]);

const requirements =
  buildToolInputRequirements(
    catalog,
    graph,
  );

const outputPath =
  "data/tool-input-requirements.json";

await Bun.write(
  outputPath,
  JSON.stringify(
    requirements,
    null,
    2,
  ),
);

console.log({
  format:
    requirements.format,
  requiredInputCount:
    requirements.summary
      .requiredInputCount,
  toolsWithRequiredInputs:
    requirements.summary
      .toolsWithRequiredInputs,
  requirementsWithToolOutput:
    requirements.summary
      .requirementsWithToolOutput,
  requirementsWithoutToolOutput:
    requirements.summary
      .requirementsWithoutToolOutput,
  userAlternativeCount:
    requirements.summary
      .userAlternativeCount,
  priorContextAlternativeCount:
    requirements.summary
      .priorContextAlternativeCount,
  toolOutputAlternativeCount:
    requirements.summary
      .toolOutputAlternativeCount,
  networkRequestsMade: false,
  llmRequestsMade: false,
  output: outputPath,
});
