import { describe, expect, test } from "bun:test";
import type { NormalizedToolCatalog } from "../src/types";
import { buildNormalizedCatalog } from "../src/normalize/index";

const catalog: NormalizedToolCatalog =
  await buildNormalizedCatalog();

function tool(slug: string) {
  const found = catalog.tools.find(
    (candidate) => candidate.metadata.slug === slug,
  );

  expect(
    found,
    `Expected normalized tool ${slug}`,
  ).toBeDefined();

  return found!;
}

function field(
  slug: string,
  direction: "input" | "output",
  jsonPath: string,
) {
  const normalizedTool = tool(slug);

  const fields =
    direction === "input"
      ? normalizedTool.inputFields
      : normalizedTool.outputFields;

  const found = fields.find(
    (candidate) => candidate.jsonPath === jsonPath,
  );

  expect(
    found,
    `Expected ${slug} ${direction} field ${jsonPath}`,
  ).toBeDefined();

  return found!;
}

describe("normalized catalog", () => {
  test("preserves every verified raw tool", () => {
    expect(catalog.format).toBe(
      "normalized-tool-catalog-v1",
    );
    expect(catalog.summary.toolCount).toBe(1360);
    expect(
      catalog.summary.toolsByToolkit.googlesuper,
    ).toBe(467);
    expect(catalog.summary.toolsByToolkit.github).toBe(
      893,
    );
  });

  test("preserves verified toolkit versions", () => {
    const google = catalog.sourceFiles.find(
      (source) => source.toolkit === "googlesuper",
    );

    const github = catalog.sourceFiles.find(
      (source) => source.toolkit === "github",
    );

    expect(google?.toolkitVersion).toBe("20260714_00");
    expect(github?.toolkitVersion).toBe("20260713_00");
  });

  test("uses unique exact tool slugs", () => {
    const slugs = catalog.tools.map(
      (candidate) => candidate.metadata.slug,
    );

    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("uses stable unique field IDs inside each tool", () => {
    for (const normalizedTool of catalog.tools) {
      const fields = [
        ...normalizedTool.inputFields,
        ...normalizedTool.outputFields,
      ];

      const ids = fields.map(
        (candidate) => candidate.fieldId,
      );

      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("runtime JSON paths do not contain schema reference markers", () => {
    for (const normalizedTool of catalog.tools) {
      for (const normalizedField of [
        ...normalizedTool.inputFields,
        ...normalizedTool.outputFields,
      ]) {
        expect(
          normalizedField.jsonPath.includes("$ref"),
        ).toBe(false);

        expect(
          normalizedField.sourceSchemaPath.length,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("representative Google normalization", () => {
  test("classifies People search from its Contacts identity", () => {
    const peopleSearch = tool(
      "GOOGLESUPER_SEARCH_PEOPLE",
    );

    expect(
      peopleSearch.metadata.underlyingService,
    ).toBe("people");

    expect(
      peopleSearch.metadata.resourceFamily,
    ).toBe("contact");

    expect(
      peopleSearch.metadata.outputSchemaCompleteness,
    ).toBe("GENERIC");
  });

  test("keeps Gmail actions in Gmail when scopes overlap", () => {
    const draft = tool(
      "GOOGLESUPER_CREATE_EMAIL_DRAFT",
    );

    const reply = tool(
      "GOOGLESUPER_REPLY_TO_THREAD",
    );

    expect(draft.metadata.underlyingService).toBe(
      "gmail",
    );

    expect(reply.metadata.underlyingService).toBe(
      "gmail",
    );
  });

  test("classifies Gmail thread IDs conservatively", () => {
    const threadId = field(
      "GOOGLESUPER_LIST_THREADS",
      "output",
      "$.data.threads[].id",
    );

    expect(threadId.canonicalEntity?.entity).toBe(
      "gmail.thread_id",
    );

    expect(threadId.canonicalEntity?.confidence).toBe(
      "HIGH",
    );

    expect(threadId.safeForInference).toBe(true);
    expect(threadId.arrayDepth).toBeGreaterThan(0);
  });

  test("keeps message and thread identifiers separate", () => {
    const messageId = field(
      "GOOGLESUPER_LIST_MESSAGES",
      "output",
      "$.data.messages[].id",
    );

    const threadId = field(
      "GOOGLESUPER_LIST_MESSAGES",
      "output",
      "$.data.messages[].threadId",
    );

    expect(messageId.canonicalEntity?.entity).toBe(
      "gmail.message_id",
    );

    expect(threadId.canonicalEntity?.entity).toBe(
      "gmail.thread_id",
    );

    expect(messageId.canonicalEntity?.entity).not.toBe(
      threadId.canonicalEntity?.entity,
    );

    expect(
      tool("GOOGLESUPER_LIST_MESSAGES").metadata
        .deprecated,
    ).toBe(true);
  });

  test("classifies Calendar event ID separately from calendar ID", () => {
    const calendarId = field(
      "GOOGLESUPER_EVENTS_LIST",
      "input",
      "$.calendarId",
    );

    const eventId = field(
      "GOOGLESUPER_EVENTS_LIST",
      "output",
      "$.data.items[].id",
    );

    expect(calendarId.canonicalEntity?.entity).toBe(
      "google.calendar_id",
    );

    expect(eventId.canonicalEntity?.entity).toBe(
      "google.event_id",
    );
  });

  test("does not treat iCalUID as a Calendar event ID", () => {
    const iCalUid = field(
      "GOOGLESUPER_EVENTS_LIST",
      "input",
      "$.iCalUID",
    );

    expect(iCalUid.canonicalEntity).toBeUndefined();
    expect(iCalUid.safeForInference).toBe(false);
  });

  test("does not treat a generic People result object as a resolved email", () => {
    const results = field(
      "GOOGLESUPER_SEARCH_PEOPLE",
      "output",
      "$.data.results[]",
    );

    expect(results.canonicalEntity).toBeUndefined();
    expect(results.safeForInference).toBe(false);
  });

  test("keeps Drive file labels outside the Gmail label namespace", () => {
    const listFileLabels = tool(
      "GOOGLESUPER_LIST_FILE_LABELS",
    );

    expect(
      listFileLabels.metadata.underlyingService,
    ).toBe("drive");

    expect(
      listFileLabels.metadata.resourceFamily,
    ).toBe("file");

    const driveLabelId = field(
      "GOOGLESUPER_LIST_FILE_LABELS",
      "output",
      "$.data.labels[].id",
    );

    expect(
      driveLabelId.canonicalEntity,
    ).toBeUndefined();

    expect(
      driveLabelId.safeForInference,
    ).toBe(false);
  });

  test("does not treat a People search query as a contact email", () => {
    const query = field(
      "GOOGLESUPER_SEARCH_PEOPLE",
      "input",
      "$.query",
    );

    expect(query.canonicalEntity).toBeUndefined();
    expect(query.safeForInference).toBe(false);
  });
  test("does not treat Calendar participant IDs as event IDs", () => {
    const creatorId = field(
      "GOOGLESUPER_EVENTS_MOVE",
      "output",
      "$.data.response_data.creator.id",
    );

    expect(creatorId.canonicalEntity).toBeUndefined();
    expect(creatorId.safeForInference).toBe(false);
  });

  test("does not treat a Drive revision ID as a file ID", () => {
    const revisionId = field(
      "GOOGLESUPER_COPY_FILE_ADVANCED",
      "output",
      "$.data.headRevisionId",
    );

    expect(revisionId.canonicalEntity).toBeUndefined();
    expect(revisionId.safeForInference).toBe(false);
  });
  test("keeps explicit issue and pull-request inputs classified", () => {
    const issueNumber = field(
      "GITHUB_CREATE_AN_ISSUE_COMMENT",
      "input",
      "$.issue_number",
    );

    const pullNumber = field(
      "GITHUB_GET_A_PULL_REQUEST",
      "input",
      "$.pull_number",
    );

    expect(issueNumber.canonicalEntity?.entity).toBe(
      "github.issue_number",
    );

    expect(issueNumber.canonicalEntity?.confidence).toBe(
      "HIGH",
    );

    expect(issueNumber.safeForInference).toBe(true);

    expect(pullNumber.canonicalEntity?.entity).toBe(
      "github.pull_request_number",
    );

    expect(pullNumber.canonicalEntity?.confidence).toBe(
      "HIGH",
    );

    expect(pullNumber.safeForInference).toBe(true);
  });

  test("does not treat Calendar watch channel IDs as calendar IDs", () => {
    const channelId = field(
      "GOOGLESUPER_CALENDAR_LIST_WATCH",
      "output",
      "$.data.id",
    );

    expect(channelId.description.toLowerCase()).toContain(
      "channel",
    );

    expect(
      channelId.canonicalEntity,
    ).toBeUndefined();

    expect(
      channelId.safeForInference,
    ).toBe(false);
  });

  test("does not treat Drive watch channel IDs as file IDs", () => {
    const channelId = field(
      "GOOGLESUPER_WATCH_FILE",
      "output",
      "$.data.id",
    );

    expect(channelId.description.toLowerCase()).toContain(
      "channel",
    );

    expect(
      channelId.canonicalEntity,
    ).toBeUndefined();

    expect(
      channelId.safeForInference,
    ).toBe(false);
  });
});

describe("representative GitHub normalization", () => {
  test("keeps workflow run ID and run number distinct when declared", () => {
    const normalizedTool = tool(
      "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
    );

    const runId = normalizedTool.outputFields.find(
      (candidate) =>
        candidate.canonicalEntity?.entity ===
        "github.workflow_run_id",
    );

    const runNumber =
      normalizedTool.outputFields.find(
        (candidate) =>
          candidate.canonicalEntity?.entity ===
          "github.workflow_run_number",
      );

    expect(runId).toBeDefined();
    expect(runNumber).toBeDefined();
    expect(runId?.jsonPath).not.toBe(
      runNumber?.jsonPath,
    );
    });

    test("restores explicitly declared convenience workflows", () => {
      const pullRequests = tool(
        "GITHUB_FIND_PULL_REQUESTS",
      );

      const repositories = tool(
        "GITHUB_FIND_REPOSITORIES",
      );

      expect(pullRequests.metadata.protocol).toBe(
        "COMPOSIO_CONVENIENCE_HELPER",
      );

      expect(
        pullRequests.metadata.abstractionLevel,
      ).toBe("CONVENIENCE_WORKFLOW");

      expect(repositories.metadata.protocol).toBe(
        "COMPOSIO_CONVENIENCE_HELPER",
      );

      expect(
        repositories.metadata.abstractionLevel,
      ).toBe("CONVENIENCE_WORKFLOW");
    });

    test("keeps job IDs separate from workflow-run IDs", () => {
      const jobId = field(
        "GITHUB_LIST_JOBS_FOR_A_WORKFLOW_RUN",
        "output",
        "$.data.jobs[].id",
      );

      const runId = field(
        "GITHUB_LIST_JOBS_FOR_A_WORKFLOW_RUN",
        "output",
        "$.data.jobs[].run_id",
      );

      expect(jobId.canonicalEntity?.entity).toBe(
        "github.job_id",
      );

      expect(jobId.canonicalEntity?.confidence).toBe(
        "HIGH",
      );

      expect(jobId.safeForInference).toBe(true);

      expect(runId.canonicalEntity?.entity).toBe(
        "github.workflow_run_id",
      );
    });

    test("does not treat job step numbers as workflow-run numbers", () => {
      const stepNumber = field(
        "GITHUB_LIST_JOBS_FOR_A_WORKFLOW_RUN",
        "output",
        "$.data.jobs[].steps[].number",
      );

      expect(
        stepNumber.canonicalEntity,
      ).toBeUndefined();

      expect(
        stepNumber.safeForInference,
      ).toBe(false);
    });

    test("keeps release-asset IDs separate from release and user IDs", () => {
      const assetId = field(
        "GITHUB_CREATE_A_RELEASE",
        "output",
        "$.data.assets[].id",
      );

      const authorId = field(
        "GITHUB_CREATE_A_RELEASE",
        "output",
        "$.data.author.id",
      );

      const uploaderId = field(
        "GITHUB_CREATE_A_RELEASE",
        "output",
        "$.data.assets[].uploader.id",
      );

      expect(assetId.canonicalEntity?.entity).toBe(
        "github.release_asset_id",
      );

      expect(
        assetId.canonicalEntity?.confidence,
      ).toBe("HIGH");

      expect(assetId.safeForInference).toBe(true);

      expect(authorId.canonicalEntity).toBeUndefined();
      expect(uploaderId.canonicalEntity).toBeUndefined();

      expect(authorId.safeForInference).toBe(false);
      expect(uploaderId.safeForInference).toBe(false);
  });

  test("does not inherit workflow identities into nested actor fields", () => {
    const actorId = field(
      "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
      "output",
      "$.data.workflow_runs[].actor.id",
    );

    const actorNodeId = field(
      "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
      "output",
      "$.data.workflow_runs[].actor.node_id",
    );

    expect(actorId.canonicalEntity).toBeUndefined();
    expect(actorNodeId.canonicalEntity).toBeUndefined();
    expect(actorId.safeForInference).toBe(false);
    expect(actorNodeId.safeForInference).toBe(false);
  });

  test("does not treat a workflow GraphQL node ID as its REST workflow ID", () => {
    const workflowNodeId = field(
      "GITHUB_LIST_REPOSITORY_WORKFLOWS",
      "output",
      "$.data.workflows[].node_id",
    );

    expect(
      workflowNodeId.canonicalEntity,
    ).toBeUndefined();

    expect(workflowNodeId.safeForInference).toBe(
      false,
    );
  });

  test("does not treat milestone number as issue or pull-request number", () => {
    const milestoneNumber = field(
      "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
      "output",
      "$.data.items[].milestone.number",
    );

    expect(
      milestoneNumber.canonicalEntity,
    ).toBeUndefined();

    expect(
      milestoneNumber.safeForInference,
    ).toBe(false);
  });

  test("does not treat repository full_name as a directly usable repository name", () => {
    const fullName = field(
      "GITHUB_FIND_REPOSITORIES",
      "output",
      "$.data.items[].full_name",
    );

    expect(fullName.canonicalEntity).toBeUndefined();
    expect(fullName.safeForInference).toBe(false);
  });

  test("classifies Projects V2 from the tool identity without inheriting legacy text", () => {
    const project = tool(
      "GITHUB_CREATE_A_USER_PROJECT",
    );

    expect(project.metadata.resourceFamily).toBe(
      "project",
    );

    expect(project.metadata.protocol).toBe(
      "GRAPHQL",
    );

    expect(project.metadata.lifecycle).toBe(
      "CURRENT",
    );

    expect(project.metadata.legacy).toBe(false);
  });

  test("preserves composition evidence for repository contents", () => {
    const normalizedTool = tool(
      "GITHUB_GET_REPOSITORY_CONTENT",
    );

    const compositionCount =
      normalizedTool.outputFields.reduce(
        (total, candidate) =>
          total + candidate.compositions.length,
        0,
      );

    expect(compositionCount).toBeGreaterThan(0);
  });

  test("keeps repository REST IDs and GraphQL node IDs separate", () => {
    const normalizedTool = tool(
      "GITHUB_FIND_REPOSITORIES",
    );

    const restId = normalizedTool.outputFields.find(
      (candidate) =>
        candidate.canonicalEntity?.entity ===
        "github.repository_id",
    );

    const nodeId =
      normalizedTool.outputFields.find(
        (candidate) =>
          candidate.canonicalEntity?.entity ===
          "github.repository_node_id",
      );

    expect(restId).toBeDefined();
    expect(nodeId).toBeDefined();
    expect(restId?.jsonPath).not.toBe(
      nodeId?.jsonPath,
    );
  });

  test("does not inherit repository identities into owner and license fields", () => {
    const ownerId = field(
      "GITHUB_FIND_REPOSITORIES",
      "output",
      "$.data.items[].owner.id",
    );

    const ownerNodeId = field(
      "GITHUB_FIND_REPOSITORIES",
      "output",
      "$.data.items[].owner.node_id",
    );

    const licenseName = field(
      "GITHUB_FIND_REPOSITORIES",
      "output",
      "$.data.items[].license.name",
    );

    const licenseNodeId = field(
      "GITHUB_FIND_REPOSITORIES",
      "output",
      "$.data.items[].license.node_id",
    );

    expect(ownerId.canonicalEntity).toBeUndefined();
    expect(ownerNodeId.canonicalEntity).toBeUndefined();
    expect(licenseName.canonicalEntity).toBeUndefined();
    expect(licenseNodeId.canonicalEntity).toBeUndefined();
  });

  test("does not treat commit-tree identities as commit SHAs", () => {
    const treeId = field(
      "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
      "output",
      "$.data.workflow_runs[].head_commit.tree_id",
    );

    expect(treeId.canonicalEntity).toBeUndefined();
    expect(treeId.safeForInference).toBe(false);
  });

  test("does not treat environment variable names as environment names", () => {
    const variableName = field(
      "GITHUB_LIST_ENVIRONMENT_VARIABLES",
      "output",
      "$.data.variables[].name",
    );

    expect(variableName.canonicalEntity).toBeUndefined();
    expect(variableName.safeForInference).toBe(false);
  });

  test("keeps combined issue and pull-request numbers ambiguous", () => {
    const resultNumber = field(
      "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
      "output",
      "$.data.items[].number",
    );

    expect(resultNumber.canonicalEntity).toBeUndefined();
    expect(resultNumber.safeForInference).toBe(false);
  });

  test("keeps repository invitation IDs separate from repository IDs", () => {
    const invitationId = field(
      "GITHUB_ADD_A_REPOSITORY_COLLABORATOR",
      "output",
      "$.data.id",
    );

    const invitationNodeId = field(
      "GITHUB_ADD_A_REPOSITORY_COLLABORATOR",
      "output",
      "$.data.node_id",
    );

    const repositoryId = field(
      "GITHUB_ADD_A_REPOSITORY_COLLABORATOR",
      "output",
      "$.data.repository.id",
    );

    const repositoryNodeId = field(
      "GITHUB_ADD_A_REPOSITORY_COLLABORATOR",
      "output",
      "$.data.repository.node_id",
    );

    expect(
      invitationId.canonicalEntity,
    ).toBeUndefined();

    expect(
      invitationNodeId.canonicalEntity,
    ).toBeUndefined();

    expect(
      invitationId.safeForInference,
    ).toBe(false);

    expect(
      invitationNodeId.safeForInference,
    ).toBe(false);

    expect(
      repositoryId.canonicalEntity?.entity,
    ).toBe("github.repository_id");

    expect(
      repositoryNodeId.canonicalEntity?.entity,
    ).toBe("github.repository_node_id");

    expect(repositoryId.safeForInference).toBe(true);
    expect(repositoryNodeId.safeForInference).toBe(true);
  });

  test("does not treat tag-protection rule IDs as repository IDs", () => {
    const ruleId = field(
      "GITHUB_CREATE_A_TAG_PROTECTION_STATE_FOR_A_REPOSITORY",
      "output",
      "$.data.id",
    );

    expect(ruleId.canonicalEntity).toBeUndefined();
    expect(ruleId.safeForInference).toBe(false);
  });
});