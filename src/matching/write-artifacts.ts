import type {
  NormalizedToolCatalog,
  OntologyDocument,
} from "../types";
import {
  buildDecisionArtifacts,
} from "./artifacts";
import type {
  GoldFixture,
} from "./artifacts";
import {
  evaluateDependencyCandidates,
  generateDependencyCandidates,
} from "./index";

const catalog = (await Bun.file(
  "data/normalized-tools.json",
).json()) as NormalizedToolCatalog;

const ontology = (await Bun.file(
  "data/ontology.json",
).json()) as OntologyDocument;

const fixture = (await Bun.file(
  "tests/fixtures/dependency-cases.json",
).json()) as GoldFixture;

const candidates =
  generateDependencyCandidates(
    catalog,
    ontology,
  );

const evaluated =
  evaluateDependencyCandidates(
    candidates,
    catalog,
  );

const artifacts =
  buildDecisionArtifacts(
    evaluated,
    catalog,
    fixture,
  );

await Bun.write(
  "data/candidates.accepted.json",
  `${JSON.stringify(
    artifacts.accepted,
    null,
    2,
  )}\n`,
);

await Bun.write(
  "data/candidates.uncertain.json",
  `${JSON.stringify(
    artifacts.uncertain,
    null,
    2,
  )}\n`,
);

await Bun.write(
  "data/candidates.rejected.json",
  `${JSON.stringify(
    artifacts.rejected,
    null,
    2,
  )}\n`,
);

await Bun.write(
  "validation-report.initial.json",
  `${JSON.stringify(
    artifacts.validationReport,
    null,
    2,
  )}\n`,
);

console.log({
  candidateCount: candidates.length,
  accepted:
    artifacts.accepted.summary
      .candidateCount,
  uncertain:
    artifacts.uncertain.summary
      .candidateCount,
  rejected:
    artifacts.rejected.summary
      .candidateCount,
  goldEvaluation:
    artifacts.validationReport
      .goldEvaluation,
  files: [
    "data/candidates.accepted.json",
    "data/candidates.uncertain.json",
    "data/candidates.rejected.json",
    "validation-report.initial.json",
  ],
});
