import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  DecisionArtifact,
} from "../src/matching";
import type {
  NormalizedToolCatalog,
} from "../src/types";
import {
  buildAdjudicationRequest,
  type AdjudicationRequest,
  type EligibilityReportFile,
} from "../src/adjudication/request-builder";
import type {
  AdjudicationDecision,
} from "../src/adjudication/schema";
import {
  validateAdjudicationResponse,
} from "../src/adjudication/validate-response";

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

const candidateId =
  eligibility.retainedCandidateIds[0];

if (!candidateId) {
  throw new Error(
    "Eligibility report contains no retained candidate.",
  );
}

const request =
  buildAdjudicationRequest(
    candidateId,
    uncertain,
    eligibility,
    catalog,
  );

function acceptedDecision(
  sourceRequest:
    AdjudicationRequest =
      request,
): AdjudicationDecision {
  return {
    candidateId:
      sourceRequest.candidateId,
    decision: "ACCEPT",
    dependencyKind: "LOOKUP",
    requiresSelection:
      sourceRequest
        .deterministicAnalysis
        .selectionRequired,
    requiresDisambiguation:
      sourceRequest
        .deterministicAnalysis
        .disambiguationRequired,
    requiresTransformation:
      false,
    evidenceReferences: [
      "producer.field.description",
      "consumer.field.description",
    ],
    reasonCodes: [
      "ENDPOINT_MEANINGS_SUPPORTED",
    ],
    explanation:
      "The producer and consumer field descriptions identify the same value type.",
  };
}

function abstainDecision(
  sourceRequest:
    AdjudicationRequest =
      request,
): AdjudicationDecision {
  return {
    candidateId:
      sourceRequest.candidateId,
    decision: "ABSTAIN",
    dependencyKind: "UNKNOWN",
    requiresSelection:
      sourceRequest
        .deterministicAnalysis
        .selectionRequired,
    requiresDisambiguation:
      sourceRequest
        .deterministicAnalysis
        .disambiguationRequired,
    requiresTransformation:
      sourceRequest
        .deterministicAnalysis
        .transformationRequired,
    evidenceReferences: [
      "candidate.primaryReason",
    ],
    reasonCodes: [
      "INSUFFICIENT_EVIDENCE",
    ],
    explanation:
      "The supplied evidence does not fully resolve the dependency.",
  };
}

function issueCodes(
  rawResponse: string,
  sourceRequest:
    AdjudicationRequest =
      request,
): string[] {
  const result =
    validateAdjudicationResponse(
      rawResponse,
      sourceRequest,
    );

  return result.issues.map(
    (issue) => issue.code,
  );
}

describe(
  "adjudication response validation",
  () => {
    test(
      "accepts one exact evidence-bound JSON object",
      () => {
        const decision =
          acceptedDecision();

        const result =
          validateAdjudicationResponse(
            JSON.stringify(decision),
            request,
          );

        expect(result.valid).toBe(
          true,
        );

        if (result.valid) {
          expect(
            result.decision,
          ).toEqual(decision);
        }
      },
    );

    test(
      "rejects invalid JSON",
      () => {
        expect(
          issueCodes(
            "{ invalid json }",
          ),
        ).toContain(
          "INVALID_JSON",
        );
      },
    );

    test(
      "rejects text around JSON",
      () => {
        const response = [
          "Here is the result:",
          JSON.stringify(
            abstainDecision(),
          ),
        ].join("\n");

        expect(
          issueCodes(response),
        ).toContain(
          "NON_JSON_CONTENT",
        );
      },
    );

    test(
      "rejects schema-invalid output",
      () => {
        const response = {
          ...abstainDecision(),
          confidence: 0.8,
        };

        expect(
          issueCodes(
            JSON.stringify(response),
          ),
        ).toContain(
          "SCHEMA_VALIDATION_FAILED",
        );
      },
    );

    test(
      "rejects a candidate ID mismatch",
      () => {
        const decision = {
          ...abstainDecision(),
          candidateId:
            "different-candidate",
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "CANDIDATE_ID_MISMATCH",
        );
      },
    );

    test(
      "rejects unknown evidence references",
      () => {
        const decision = {
          ...abstainDecision(),
          evidenceReferences: [
            "candidate.unknown",
          ],
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "UNKNOWN_EVIDENCE_REFERENCE",
        );
      },
    );

    test(
      "classifies unknown tool references",
      () => {
        const decision = {
          ...abstainDecision(),
          evidenceReferences: [
            "GITHUB_FAKE_TOOL",
          ],
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "UNKNOWN_TOOL_REFERENCE",
        );
      },
    );

    test(
      "classifies unknown path references",
      () => {
        const decision = {
          ...abstainDecision(),
          evidenceReferences: [
            "$.unknown.id",
          ],
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "UNKNOWN_PATH_REFERENCE",
        );
      },
    );

    test(
      "classifies unknown entity references",
      () => {
        const decision = {
          ...abstainDecision(),
          evidenceReferences: [
            "github.unknown_id",
          ],
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "UNKNOWN_ENTITY_REFERENCE",
        );
      },
    );

    test(
      "classifies unknown scope references",
      () => {
        const decision = {
          ...abstainDecision(),
          evidenceReferences: [
            "scope:unknown",
          ],
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "UNKNOWN_SCOPE_REFERENCE",
        );
      },
    );

    test(
      "rejects ignored collection selection",
      () => {
        const selectionRequest:
          AdjudicationRequest = {
            ...request,
            deterministicAnalysis: {
              ...request
                .deterministicAnalysis,
              selectionRequired: true,
            },
          };

        const decision = {
          ...abstainDecision(
            selectionRequest,
          ),
          requiresSelection: false,
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
            selectionRequest,
          ),
        ).toContain(
          "COLLECTION_SELECTION_IGNORED",
        );
      },
    );

    test(
      "rejects ignored disambiguation",
      () => {
        const decision = {
          ...abstainDecision(),
          requiresDisambiguation:
            false,
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "DISAMBIGUATION_IGNORED",
        );
      },
    );

    test(
      "rejects unsupported transformation claims",
      () => {
        const decision = {
          ...acceptedDecision(),
          dependencyKind:
            "TRANSFORMATION",
          requiresTransformation:
            true,
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "UNSUPPORTED_TRANSFORMATION",
        );
      },
    );

    test(
      "rejects a deterministic hard-rule conflict",
      () => {
        const conflictRequest:
          AdjudicationRequest = {
            ...request,
            deterministicAnalysis: {
              ...request
                .deterministicAnalysis,
              checks: {
                ...request
                  .deterministicAnalysis
                  .checks,
                typeCompatible:
                  false,
              },
            },
          };

        expect(
          issueCodes(
            JSON.stringify(
              acceptedDecision(
                conflictRequest,
              ),
            ),
            conflictRequest,
          ),
        ).toContain(
          "DETERMINISTIC_HARD_RULE_CONFLICT",
        );
      },
    );

    test(
      "requires endpoint evidence for ACCEPT",
      () => {
        const decision = {
          ...acceptedDecision(),
          evidenceReferences: [
            "candidate.reasonCodes",
          ],
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "MISSING_EVIDENCE",
        );
      },
    );

    test(
      "rejects explicit external knowledge",
      () => {
        const decision = {
          ...abstainDecision(),
          explanation:
            "According to external API documentation, this dependency is valid.",
        };

        expect(
          issueCodes(
            JSON.stringify(decision),
          ),
        ).toContain(
          "EXTERNAL_KNOWLEDGE_USED",
        );
      },
    );
  },
);