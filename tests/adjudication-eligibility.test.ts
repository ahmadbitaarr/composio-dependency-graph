import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  CompactCandidateRecord,
  DecisionArtifact,
} from "../src/matching";
import type {
  NormalizedToolCatalog,
} from "../src/types";
import {
  assessCandidateEligibility,
  assessUncertainArtifact,
  createEligibilityContext,
} from "../src/adjudication/eligibility";
import {
  createSemanticHashContext,
  deduplicateEligibleCandidates,
  semanticCandidateHashWithContext,
} from "../src/adjudication/deduplicate";

const uncertain =
  (await Bun.file(
    "data/candidates.uncertain.json",
  ).json()) as DecisionArtifact;

const catalog =
  (await Bun.file(
    "data/normalized-tools.json",
  ).json()) as NormalizedToolCatalog;

const context =
  createEligibilityContext(catalog);

function candidate(
  id: string,
): CompactCandidateRecord {
  const value =
    uncertain.candidates.find(
      (item) => item.id === id,
    );

  if (!value) {
    throw new Error(
      `Missing reviewed candidate: ${id}`,
    );
  }

  return value;
}

describe(
  "adjudication eligibility filtering",
  () => {
    test(
      "partitions every current uncertain candidate",
      () => {
        const assessments =
          assessUncertainArtifact(
            uncertain,
            catalog,
          );

        expect(
          uncertain.summary
            .candidateCount,
        ).toBe(25150);

        expect(
          uncertain.candidates.length,
        ).toBe(25150);

        expect(
          assessments.length,
        ).toBe(25150);

        expect(
          new Set(
            assessments.map(
              (item) =>
                item.candidateId,
            ),
          ).size,
        ).toBe(25150);
      },
    );

    test(
      "keeps reviewed evidence-bound ambiguity eligible",
      () => {
        const ids = [
          "GOOGLESUPER_GET_CONTACTS:output:$.data.connections[].emailAddresses[].value=>GOOGLESUPER_CREATE_EMAIL_DRAFT:input:$.recipient_email",
          "GITHUB_FIND_REPOSITORIES:output:$.data.items[].full_name=>GITHUB_ADD_APP_ACCESS_RESTRICTIONS:input:$.repo",
          "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS:output:$.data.items[].number=>GITHUB_ADD_ASSIGNEES_TO_AN_ISSUE:input:$.issue_number",
        ];

        for (const id of ids) {
          const result =
            assessCandidateEligibility(
              candidate(id),
              context,
            );

          expect(result.category).toBe(
            "ELIGIBLE",
          );

          expect(
            result.resolvableQuestions
              .length,
          ).toBeGreaterThan(0);
        }
      },
    );

    test(
      "keeps supported low-confidence semantic review eligible",
      () => {
        const value = candidate(
          "GITHUB_COMMIT_MULTIPLE_FILES:output:$.data.commit.sha=>GITHUB_CREATE_A_COMMIT_STATUS:input:$.sha",
        );

        const result =
          assessCandidateEligibility(
            value,
            context,
          );

        expect(result.category).toBe(
          "ELIGIBLE",
        );

        expect(
          result.reasonCodes,
        ).toContain(
          "LOW_CONFIDENCE_ENTITY_REVIEWABLE",
        );
      },
    );

    test(
      "filters pure collection selection as low value",
      () => {
        const value = candidate(
          "GITHUB_LIST_BRANCHES:output:$.data.branches[].name=>GITHUB_ADD_STATUS_CHECK_CONTEXTS:input:$.branch",
        );

        const result =
          assessCandidateEligibility(
            value,
            context,
          );

        expect(result.category).toBe(
          "INELIGIBLE_LOW_VALUE",
        );

        expect(
          result.reasonCodes,
        ).toContain(
          "PURE_COLLECTION_SELECTION_ALREADY_DETERMINISTIC",
        );
      },
    );

    test(
      "rejects candidates whose exact path no longer exists",
      () => {
        const original = candidate(
          "GITHUB_COMMIT_MULTIPLE_FILES:output:$.data.commit.sha=>GITHUB_CREATE_A_COMMIT_STATUS:input:$.sha",
        );

        const broken =
          structuredClone(original);

        broken.id =
          `${original.id}:broken`;

        broken.producer.fieldId =
          "missing:producer:field";

        broken.producer.path =
          "$.missing";

        const result =
          assessCandidateEligibility(
            broken,
            context,
          );

        expect(result.category).toBe(
          "INELIGIBLE_HARD_CONFLICT",
        );

        expect(
          result.reasonCodes,
        ).toContain(
          "PRODUCER_PATH_NOT_FOUND",
        );
      },
    );

    test(
      "deduplicates semantically identical evidence records",
      () => {
        const original = candidate(
          "GITHUB_COMMIT_MULTIPLE_FILES:output:$.data.commit.sha=>GITHUB_CREATE_A_COMMIT_STATUS:input:$.sha",
        );

        const duplicate =
          structuredClone(original);

        duplicate.id =
          `${original.id}:duplicate`;

        const result =
          deduplicateEligibleCandidates(
            [duplicate, original],
            catalog,
          );

        expect(
          result.retained.length,
        ).toBe(1);

        expect(
          result.clusters.length,
        ).toBe(1);

        expect(
          Object.keys(
            result.duplicateOf,
          ).length,
        ).toBe(1);
      },
    );

    test(
      "retains one candidate per semantic cluster",
      () => {
        const assessments =
          assessUncertainArtifact(
            uncertain,
            catalog,
          );

        const assessmentById =
          new Map(
            assessments.map(
              (item) => [
                item.candidateId,
                item,
              ],
            ),
          );

        const eligible =
          uncertain.candidates.filter(
            (item) =>
              assessmentById.get(
                item.id,
              )?.category ===
              "ELIGIBLE",
          );

        const result =
          deduplicateEligibleCandidates(
            eligible,
            catalog,
          );

        const hashContext =
          createSemanticHashContext(
            catalog,
          );

        const hashes =
          result.retained.map(
            (item) =>
              semanticCandidateHashWithContext(
                item,
                hashContext,
              ),
          );

        expect(
          new Set(hashes).size,
        ).toBe(hashes.length);

        expect(
          result.retained.length +
            Object.keys(
              result.duplicateOf,
            ).length,
        ).toBe(eligible.length);
      },
    );

    test(
      "is deterministic for identical inputs",
      () => {
        const assessmentsOne =
          assessUncertainArtifact(
            uncertain,
            catalog,
          );

        const assessmentsTwo =
          assessUncertainArtifact(
            uncertain,
            catalog,
          );

        expect(
          assessmentsTwo,
        ).toEqual(assessmentsOne);
      },
    );
  },
);