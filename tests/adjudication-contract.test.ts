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
  buildAdjudicationPrompt,
} from "../src/adjudication/prompt";
import {
  buildAdjudicationRequest,
  type EligibilityReportFile,
} from "../src/adjudication/request-builder";
import {
  AdjudicationDecisionSchema,
  parseAdjudicationDecision,
  type AdjudicationDecision,
} from "../src/adjudication/schema";

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

const primaryCandidateId =
  eligibility.retainedCandidateIds[0];

if (!primaryCandidateId) {
  throw new Error(
    "Eligibility report contains no retained candidate.",
  );
}

describe(
  "adjudication request contract",
  () => {
    test(
      "builds exactly one eligible candidate request",
      () => {
        const request =
          buildAdjudicationRequest(
            primaryCandidateId,
            uncertain,
            eligibility,
            catalog,
          );

        expect(request.format).toBe(
          "adjudication-request-v1",
        );

        expect(
          request.candidateId,
        ).toBe(primaryCandidateId);

        expect(
          request.producer.field
            .fieldId,
        ).toBeTruthy();

        expect(
          request.consumer.field
            .fieldId,
        ).toBeTruthy();
      },
    );

    test(
      "uses unique allowed evidence references",
      () => {
        const request =
          buildAdjudicationRequest(
            primaryCandidateId,
            uncertain,
            eligibility,
            catalog,
          );

        expect(
          request.evidence.length,
        ).toBeGreaterThan(20);

        expect(
          request
            .allowedEvidenceReferences,
        ).toEqual(
          request.evidence.map(
            (entry) =>
              entry.reference,
          ),
        );

        expect(
          new Set(
            request
              .allowedEvidenceReferences,
          ).size,
        ).toBe(
          request
            .allowedEvidenceReferences
            .length,
        );
      },
    );

    test(
      "does not include raw schema fragments",
      () => {
        const request =
          buildAdjudicationRequest(
            primaryCandidateId,
            uncertain,
            eligibility,
            catalog,
          );

        const serialized =
          JSON.stringify(request);

        expect(serialized).not.toContain(
          "rawSchemaFragment",
        );
      },
    );

    test(
      "rejects a candidate not retained by eligibility",
      () => {
        const retained = new Set(
          eligibility
            .retainedCandidateIds,
        );

        const ineligible =
          uncertain.candidates.find(
            (candidate) =>
              !retained.has(
                candidate.id,
              ),
          );

        expect(ineligible).toBeTruthy();

        expect(() =>
          buildAdjudicationRequest(
            ineligible!.id,
            uncertain,
            eligibility,
            catalog,
          ),
        ).toThrow(
          "Candidate is not retained as eligible",
        );
      },
    );

    test(
      "builds a JSON-only evidence-bound prompt",
      () => {
        const request =
          buildAdjudicationRequest(
            primaryCandidateId,
            uncertain,
            eligibility,
            catalog,
          );

        const prompt =
          buildAdjudicationPrompt(
            request,
          );

        expect(prompt).toContain(
          "Return exactly one JSON object",
        );

        expect(prompt).toContain(
          "Do not use outside API knowledge",
        );

        expect(prompt).toContain(
          primaryCandidateId,
        );

        expect(prompt).not.toContain(
          "deterministicPriority",
        );
      },
    );

    test(
      "does not place another candidate in the prompt",
      () => {
        const secondCandidateId =
          eligibility
            .retainedCandidateIds[1];

        if (!secondCandidateId) {
          throw new Error(
            "Expected at least two retained candidates.",
          );
        }

        const request =
          buildAdjudicationRequest(
            primaryCandidateId,
            uncertain,
            eligibility,
            catalog,
          );

        const prompt =
          buildAdjudicationPrompt(
            request,
          );

        expect(prompt).not.toContain(
          JSON.stringify(
            secondCandidateId,
          ),
        );
      },
    );

    test(
      "accepts the exact adjudication output contract",
      () => {
        const request =
          buildAdjudicationRequest(
            primaryCandidateId,
            uncertain,
            eligibility,
            catalog,
          );

        const value: AdjudicationDecision = {
          candidateId:
            primaryCandidateId,
          decision: "ABSTAIN",
          dependencyKind:
            "UNKNOWN",
          requiresSelection:
            request
              .deterministicAnalysis
              .selectionRequired,
          requiresDisambiguation:
            request
              .deterministicAnalysis
              .disambiguationRequired,
          requiresTransformation:
            request
              .deterministicAnalysis
              .transformationRequired,
          evidenceReferences: [
            request
              .allowedEvidenceReferences[0],
          ],
          reasonCodes: [
            "INSUFFICIENT_EVIDENCE",
          ],
          explanation:
            "The stored evidence does not fully resolve the dependency.",
        };

        expect(
          parseAdjudicationDecision(
            value,
          ),
        ).toEqual(value);
      },
    );

    test(
      "rejects invalid decisions and extra properties",
      () => {
        const invalidDecision =
          AdjudicationDecisionSchema
            .safeParse({
              candidateId:
                primaryCandidateId,
              decision: "MAYBE",
              dependencyKind:
                "UNKNOWN",
              requiresSelection:
                false,
              requiresDisambiguation:
                false,
              requiresTransformation:
                false,
              evidenceReferences: [
                "candidate.reasonCodes",
              ],
              reasonCodes: [
                "INVALID",
              ],
              explanation:
                "Invalid decision.",
            });

        expect(
          invalidDecision.success,
        ).toBe(false);

        const extraProperty =
          AdjudicationDecisionSchema
            .safeParse({
              candidateId:
                primaryCandidateId,
              decision: "ABSTAIN",
              dependencyKind:
                "UNKNOWN",
              requiresSelection:
                false,
              requiresDisambiguation:
                true,
              requiresTransformation:
                false,
              evidenceReferences: [
                "candidate.reasonCodes",
              ],
              reasonCodes: [
                "INSUFFICIENT_EVIDENCE",
              ],
              explanation:
                "Insufficient evidence.",
              confidence: 0.9,
            });

        expect(
          extraProperty.success,
        ).toBe(false);
      },
    );
  },
);