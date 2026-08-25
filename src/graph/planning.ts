import type {
  DependencyGraphArtifact,
  DependencyGraphEdge,
} from "./assemble";
import type {
  ToolInputRequirementsArtifact,
} from "./requirements";

export type AskUserPlanOption = {
  kind: "ASK_USER";
  requirementId: string;
  inputPath: string;
  reason: string;
  preferred: boolean;
};

export type UsePriorContextPlanOption = {
  kind: "USE_PRIOR_CONTEXT";
  requirementId: string;
  inputPath: string;
  reason: string;
  preferred: boolean;
};

export type RunPrecursorToolPlanOption = {
  kind: "RUN_PRECURSOR_TOOL";
  requirementId: string;
  inputPath: string;
  reason: string;
  preferred: false;
  edgeId: string;
  precursorToolSlug: string;
  targetToolSlug: string;
  producerOutputNodeId: string;
  consumerInputNodeId: string;
  selectionRequired: boolean;
  transformationRequired: boolean;
  disambiguationRequired: boolean;
  sharedScopeEntities: string[];
};

export type PlanResolutionOption =
  | AskUserPlanOption
  | UsePriorContextPlanOption
  | RunPrecursorToolPlanOption;

export type PlannedInputRequirement = {
  requirementId: string;
  inputPath: string;
  fieldName: string;
  jsonTypes: string[];
  canonicalEntity: string | null;
  resolutionOptions:
    PlanResolutionOption[];
};

export type ToolPlanTemplate = {
  toolSlug: string;
  requiredInputs:
    PlannedInputRequirement[];
};

export type PlanningCatalogArtifact = {
  format:
    "tool-planning-catalog-v1";
  generatedFrom: {
    graphFormat:
      DependencyGraphArtifact[
        "format"
      ];
    graphEdgeCount: number;
    requirementsFormat:
      ToolInputRequirementsArtifact[
        "format"
      ];
    requiredInputCount: number;
  };
  summary: {
    toolPlanCount: number;
    requiredInputCount: number;
    askUserOptionCount: number;
    priorContextOptionCount: number;
    precursorToolOptionCount: number;
    toolsWithPrecursorOptions:
      number;
    inputsWithPrecursorOptions:
      number;
    inputsWithoutPrecursorOptions:
      number;
  };
  toolPlans:
    ToolPlanTemplate[];
};

function compareStrings(
  left: string,
  right: string,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function graphEdgesById(
  graph:
    DependencyGraphArtifact,
): Map<
  string,
  DependencyGraphEdge
> {
  return new Map(
    graph.edges.map(
      (edge) => [
        edge.id,
        edge,
      ],
    ),
  );
}

export function buildPlanningCatalog(
  requirements:
    ToolInputRequirementsArtifact,
  graph:
    DependencyGraphArtifact,
): PlanningCatalogArtifact {
  if (
    requirements.format !==
    "tool-input-requirements-v1"
  ) {
    throw new Error(
      `Unsupported requirements format: ${requirements.format}`,
    );
  }

  if (
    graph.format !==
    "tool-dependency-graph-v1"
  ) {
    throw new Error(
      `Unsupported graph format: ${graph.format}`,
    );
  }

  const edgeById =
    graphEdgesById(graph);

  const requirementsByTool =
    new Map<
      string,
      PlannedInputRequirement[]
    >();

  let askUserOptionCount = 0;
  let priorContextOptionCount =
    0;
  let precursorToolOptionCount =
    0;
  let inputsWithPrecursorOptions =
    0;

  const toolsWithPrecursorOptions =
    new Set<string>();

  for (
    const requirement
    of requirements.requirements
  ) {
    const resolutionOptions:
      PlanResolutionOption[] =
      [];

    let hasPrecursor = false;

    for (
      const alternative
      of requirement.alternatives
    ) {
      if (
        alternative.kind ===
        "USER"
      ) {
        askUserOptionCount += 1;

        resolutionOptions.push({
          kind: "ASK_USER",
          requirementId:
            requirement.id,
          inputPath:
            requirement.inputPath,
          reason:
            alternative.reason,
          preferred:
            alternative.preferred,
        });

        continue;
      }

      if (
        alternative.kind ===
        "PRIOR_CONTEXT"
      ) {
        priorContextOptionCount +=
          1;

        resolutionOptions.push({
          kind:
            "USE_PRIOR_CONTEXT",
          requirementId:
            requirement.id,
          inputPath:
            requirement.inputPath,
          reason:
            alternative.reason,
          preferred:
            alternative.preferred,
        });

        continue;
      }

      const edge =
        edgeById.get(
          alternative.edgeId,
        );

      if (!edge) {
        throw new Error(
          `Missing graph edge for planning option: ${alternative.edgeId}`,
        );
      }

      if (
        edge.to !==
        requirement.id
      ) {
        throw new Error(
          `Graph edge ${edge.id} does not satisfy requirement ${requirement.id}.`,
        );
      }

      hasPrecursor = true;
      precursorToolOptionCount +=
        1;

      resolutionOptions.push({
        kind:
          "RUN_PRECURSOR_TOOL",
        requirementId:
          requirement.id,
        inputPath:
          requirement.inputPath,
        reason:
          alternative.reason,
        preferred: false,
        edgeId: edge.id,
        precursorToolSlug:
          edge.producerTool,
        targetToolSlug:
          edge.consumerTool,
        producerOutputNodeId:
          edge.from,
        consumerInputNodeId:
          edge.to,
        selectionRequired:
          edge.selectionRequired,
        transformationRequired:
          edge
            .transformationRequired,
        disambiguationRequired:
          edge
            .disambiguationRequired,
        sharedScopeEntities: [
          ...edge.scope
            .sharedEntities,
        ],
      });
    }

    if (hasPrecursor) {
      inputsWithPrecursorOptions +=
        1;

      toolsWithPrecursorOptions.add(
        requirement.toolSlug,
      );
    }

    resolutionOptions.sort(
      (left, right) => {
        const order = {
          USE_PRIOR_CONTEXT: 0,
          RUN_PRECURSOR_TOOL: 1,
          ASK_USER: 2,
        };

        const orderDifference =
          order[left.kind] -
          order[right.kind];

        if (
          orderDifference !== 0
        ) {
          return orderDifference;
        }

        if (
          left.kind ===
            "RUN_PRECURSOR_TOOL" &&
          right.kind ===
            "RUN_PRECURSOR_TOOL"
        ) {
          return compareStrings(
            left.edgeId,
            right.edgeId,
          );
        }

        return 0;
      },
    );

    const plannedRequirement:
      PlannedInputRequirement = {
      requirementId:
        requirement.id,
      inputPath:
        requirement.inputPath,
      fieldName:
        requirement.fieldName,
      jsonTypes: [
        ...requirement.jsonTypes,
      ],
      canonicalEntity:
        requirement
          .canonicalEntity,
      resolutionOptions,
    };

    const existing =
      requirementsByTool.get(
        requirement.toolSlug,
      ) ?? [];

    existing.push(
      plannedRequirement,
    );

    requirementsByTool.set(
      requirement.toolSlug,
      existing,
    );
  }

  const toolPlans =
    [
      ...requirementsByTool
        .entries(),
    ]
      .map(
        (
          [
            toolSlug,
            requiredInputs,
          ],
        ): ToolPlanTemplate => ({
          toolSlug,
          requiredInputs:
            requiredInputs.sort(
              (left, right) =>
                compareStrings(
                  left.requirementId,
                  right.requirementId,
                ),
            ),
        }),
      )
      .sort(
        (left, right) =>
          compareStrings(
            left.toolSlug,
            right.toolSlug,
          ),
      );

  return {
    format:
      "tool-planning-catalog-v1",
    generatedFrom: {
      graphFormat:
        graph.format,
      graphEdgeCount:
        graph.edges.length,
      requirementsFormat:
        requirements.format,
      requiredInputCount:
        requirements
          .requirements.length,
    },
    summary: {
      toolPlanCount:
        toolPlans.length,
      requiredInputCount:
        requirements
          .requirements.length,
      askUserOptionCount,
      priorContextOptionCount,
      precursorToolOptionCount,
      toolsWithPrecursorOptions:
        toolsWithPrecursorOptions
          .size,
      inputsWithPrecursorOptions,
      inputsWithoutPrecursorOptions:
        requirements
          .requirements.length -
        inputsWithPrecursorOptions,
    },
    toolPlans,
  };
}
