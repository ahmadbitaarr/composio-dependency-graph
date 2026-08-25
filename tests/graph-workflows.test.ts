import {
  describe,
  expect,
  test,
} from "bun:test";

import type {
  PlanningCatalogArtifact,
  PlanResolutionOption,
  ToolPlanTemplate,
} from "../src/graph/planning";

const planning =
  (await Bun.file(
    "data/tool-planning-catalog.json",
  ).json()) as PlanningCatalogArtifact;

function toolPlan(
  toolSlug: string,
): ToolPlanTemplate {
  const plan =
    planning.toolPlans.find(
      (candidate) =>
        candidate.toolSlug ===
        toolSlug,
    );

  if (!plan) {
    throw new Error(
      `Missing tool plan: ${toolSlug}`,
    );
  }

  return plan;
}

function requiredInput(
  plan: ToolPlanTemplate,
  inputPath: string,
) {
  const input =
    plan.requiredInputs.find(
      (candidate) =>
        candidate.inputPath ===
        inputPath,
    );

  if (!input) {
    throw new Error(
      `Missing required input ${inputPath} for ${plan.toolSlug}`,
    );
  }

  return input;
}

function precursorOptions(
  options:
    PlanResolutionOption[],
) {
  return options.filter(
    (
      option,
    ): option is Extract<
      PlanResolutionOption,
      {
        kind:
          "RUN_PRECURSOR_TOOL";
      }
    > =>
      option.kind ===
      "RUN_PRECURSOR_TOOL",
  );
}

describe(
  "representative dependency workflows",
  () => {
    test(
      "resolves Gmail reply thread_id through user, context, or precursor tools",
      () => {
        const plan =
          toolPlan(
            "GOOGLESUPER_REPLY_TO_THREAD",
          );

        const threadId =
          requiredInput(
            plan,
            "$.thread_id",
          );

        expect(
          threadId
            .canonicalEntity,
        ).toBe(
          "gmail.thread_id",
        );

        expect(
          threadId
            .resolutionOptions
            .some(
              (option) =>
                option.kind ===
                "ASK_USER",
            ),
        ).toBe(true);

        expect(
          threadId
            .resolutionOptions
            .some(
              (option) =>
                option.kind ===
                "USE_PRIOR_CONTEXT",
            ),
        ).toBe(true);

        const precursors =
          precursorOptions(
            threadId
              .resolutionOptions,
          );

        expect(
          precursors.map(
            (option) =>
              option
                .precursorToolSlug,
          ).sort(),
        ).toEqual([
          "GOOGLESUPER_FETCH_MESSAGE_BY_MESSAGE_ID",
          "GOOGLESUPER_GET_DRAFT",
        ]);
      },
    );

    test(
      "resolves GitHub issue number through issue-producing tools",
      () => {
        const plan =
          toolPlan(
            "GITHUB_ADD_ASSIGNEES_TO_AN_ISSUE",
          );

        const issueNumber =
          requiredInput(
            plan,
            "$.issue_number",
          );

        expect(
          issueNumber
            .canonicalEntity,
        ).toBe(
          "github.issue_number",
        );

        const precursorSlugs =
          precursorOptions(
            issueNumber
              .resolutionOptions,
          ).map(
            (option) =>
              option
                .precursorToolSlug,
          );

        expect(
          precursorSlugs,
        ).toContain(
          "GITHUB_CREATE_AN_ISSUE",
        );

        expect(
          precursorSlugs.length,
        ).toBe(2);
      },
    );

    test(
      "asks for GitHub owner when no accepted precursor exists",
      () => {
        const plan =
          toolPlan(
            "GITHUB_ADD_ASSIGNEES_TO_AN_ISSUE",
          );

        const owner =
          requiredInput(
            plan,
            "$.owner",
          );

        expect(
          owner.canonicalEntity,
        ).toBe(
          "github.owner",
        );

        expect(
          precursorOptions(
            owner.resolutionOptions,
          ).length,
        ).toBe(0);

        expect(
          owner.resolutionOptions
            .some(
              (option) =>
                option.kind ===
                "ASK_USER",
            ),
        ).toBe(true);

        expect(
          owner.resolutionOptions
            .some(
              (option) =>
                option.kind ===
                "USE_PRIOR_CONTEXT",
            ),
        ).toBe(true);
      },
    );

    test(
      "resolves repository name using accepted repository-producing tools",
      () => {
        const plan =
          toolPlan(
            "GITHUB_ADD_ASSIGNEES_TO_AN_ISSUE",
          );

        const repository =
          requiredInput(
            plan,
            "$.repo",
          );

        expect(
          repository
            .canonicalEntity,
        ).toBe(
          "github.repository_name",
        );

        expect(
          precursorOptions(
            repository
              .resolutionOptions,
          ).length,
        ).toBe(10);
      },
    );

    test(
      "uses a created pull request as a precursor for later pull-request actions",
      () => {
        const plan =
          toolPlan(
            "GITHUB_CLOSE_PULL_REQUEST",
          );

        const pullNumber =
          requiredInput(
            plan,
            "$.pull_number",
          );

        expect(
          pullNumber
            .canonicalEntity,
        ).toBe(
          "github.pull_request_number",
        );

        const precursorSlugs =
          precursorOptions(
            pullNumber
              .resolutionOptions,
          ).map(
            (option) =>
              option
                .precursorToolSlug,
          );

        expect(
          precursorSlugs,
        ).toContain(
          "GITHUB_CREATE_A_PULL_REQUEST",
        );
      },
    );
  },
);
