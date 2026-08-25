import {
  mkdir,
} from "node:fs/promises";

import type {
  DecisionArtifact,
} from "../matching";
import type {
  NormalizedToolCatalog,
} from "../types";
import {
  buildAdjudicationPrompt,
} from "./prompt";
import {
  buildAdjudicationRequest,
  type EligibilityReportFile,
} from "./request-builder";

const uncertain =
  (await Bun.file(
    "data/candidates.uncertain.json",
  ).json()) as DecisionArtifact;

const catalog =
  (await Bun.file(
    "data/normalized-tools.json",
  ).json()) as NormalizedToolCatalog;

const eligibility =
  (await Bun.file(
    "data/adjudication/eligibility-report.json",
  ).json()) as EligibilityReportFile;

const candidateFlagIndex =
  Bun.argv.indexOf("--candidate-id");

const requestedCandidateId =
  candidateFlagIndex >= 0
    ? Bun.argv[candidateFlagIndex + 1]
    : undefined;

if (
  candidateFlagIndex >= 0 &&
  !requestedCandidateId
) {
  throw new Error(
    "--candidate-id requires a value.",
  );
}

const candidateId =
  requestedCandidateId ??
  eligibility.retainedCandidateIds[0];

if (!candidateId) {
  throw new Error(
    "No retained eligible candidate is available.",
  );
}

const request =
  buildAdjudicationRequest(
    candidateId,
    uncertain,
    eligibility,
    catalog,
  );

const prompt =
  buildAdjudicationPrompt(request);

try {
  await mkdir(
    "data/adjudication",
    {
      recursive: true,
    },
  );
} catch (error) {
  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? error.code
      : undefined;

  if (errorCode !== "EEXIST") {
    throw error;
  }
}

const requestPath =
  "data/adjudication/request-preview.json";

const promptPath =
  "data/adjudication/prompt-preview.txt";

await Bun.write(
  requestPath,
  JSON.stringify(request, null, 2),
);

await Bun.write(
  promptPath,
  prompt,
);

console.log({
  candidateId:
    request.candidateId,
  evidenceReferenceCount:
    request
      .allowedEvidenceReferences
      .length,
  deterministicPriority:
    request
      .deterministicPriority,
  promptVersion:
    request.promptVersion,
  llmRequestsMade: false,
  outputs: [
    requestPath,
    promptPath,
  ],
});