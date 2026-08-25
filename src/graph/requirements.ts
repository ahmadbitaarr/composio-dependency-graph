import type {
  DependencyGraphArtifact,
  DependencyGraphEdge,
} from "./assemble";
import type {
  NormalizedSchemaField,
  NormalizedToolCatalog,
  ValueSourceOption,
} from "../types";

export type UserValueAlternative = {
  kind: "USER";
  preferred: boolean;
  reason: string;
};

export type PriorContextAlternative = {
  kind: "PRIOR_CONTEXT";
  preferred: boolean;
  reason: string;
};

export type ToolOutputAlternative = {
  kind: "TOOL_OUTPUT";
  preferred: false;
  reason: string;
  edgeId: string;
  producerNodeId: string;
  producerToolSlug: string;
};

export type RequirementAlternative =
  | UserValueAlternative
  | PriorContextAlternative
  | ToolOutputAlternative;

export type ToolInputRequirement = {
  id: string;
  toolSlug: string;
  inputPath: string;
  fieldName: string;
  jsonTypes: string[];
  canonicalEntity: string | null;
  effectivelyRequired: true;
  alternatives: RequirementAlternative[];
};

export type ToolInputRequirementsArtifact = {
  format:
    "tool-input-requirements-v1";
  generatedFrom: {
    catalogFormat: string;
    catalogToolCount: number;
    graphFormat:
      DependencyGraphArtifact[
        "format"
      ];
    graphEdgeCount: number;
  };
  summary: {
    requiredInputCount: number;
    toolsWithRequiredInputs:
      number;
    requirementsWithToolOutput:
      number;
    requirementsWithoutToolOutput:
      number;
    userAlternativeCount:
      number;
    priorContextAlternativeCount:
      number;
    toolOutputAlternativeCount:
      number;
  };
  requirements:
    ToolInputRequirement[];
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

function valueSource(
  field:
    NormalizedSchemaField,
  source:
    | "USER"
    | "PRIOR_CONTEXT",
): ValueSourceOption {
  const option =
    field.possibleValueSources.find(
      (candidate) =>
        candidate.source ===
        source,
    );

  if (!option) {
    throw new Error(
      `Required input ${field.fieldId} is missing ${source} as a possible value source.`,
    );
  }

  return option;
}

function incomingEdges(
  graph:
    DependencyGraphArtifact,
): Map<
  string,
  DependencyGraphEdge[]
> {
  const byConsumer =
    new Map<
      string,
      DependencyGraphEdge[]
    >();

  for (
    const edge
    of graph.edges
  ) {
    const existing =
      byConsumer.get(edge.to) ??
      [];

    existing.push(edge);
    byConsumer.set(
      edge.to,
      existing,
    );
  }

  for (
    const edges
    of byConsumer.values()
  ) {
    edges.sort(
      (left, right) =>
        compareStrings(
          left.id,
          right.id,
        ),
    );
  }

  return byConsumer;
}

export function buildToolInputRequirements(
  catalog:
    NormalizedToolCatalog,
  graph:
    DependencyGraphArtifact,
): ToolInputRequirementsArtifact {
  if (
    catalog.format !==
    "normalized-tool-catalog-v1"
  ) {
    throw new Error(
      `Unsupported catalog format: ${catalog.format}`,
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

  const edgesByConsumer =
    incomingEdges(graph);

  const requirements:
    ToolInputRequirement[] =
    [];

  const toolsWithRequirements =
    new Set<string>();

  let requirementsWithToolOutput =
    0;

  let toolOutputAlternativeCount =
    0;

  const tools = [
    ...catalog.tools,
  ].sort(
    (left, right) =>
      compareStrings(
        left.metadata.slug,
        right.metadata.slug,
      ),
  );

  for (
    const tool
    of tools
  ) {
    const requiredFields =
      tool.inputFields
        .filter(
          (field) =>
            field.effectivelyRequired,
        )
        .sort(
          (left, right) =>
            compareStrings(
              left.fieldId,
              right.fieldId,
            ),
        );

    for (
      const field
      of requiredFields
    ) {
      const user =
        valueSource(
          field,
          "USER",
        );

      const priorContext =
        valueSource(
          field,
          "PRIOR_CONTEXT",
        );

      const edges =
        edgesByConsumer.get(
          field.fieldId,
        ) ?? [];

      const alternatives:
        RequirementAlternative[] =
        [
          {
            kind: "USER",
            preferred:
              user.preferred,
            reason: user.reason,
          },
          {
            kind:
              "PRIOR_CONTEXT",
            preferred:
              priorContext
                .preferred,
            reason:
              priorContext.reason,
          },
          ...edges.map(
            (
              edge,
            ): ToolOutputAlternative => ({
              kind:
                "TOOL_OUTPUT",
              preferred: false,
              reason:
                "A deterministically accepted dependency edge produces this input value.",
              edgeId: edge.id,
              producerNodeId:
                edge.from,
              producerToolSlug:
                edge.producerTool,
            }),
          ),
        ];

      if (
        edges.length > 0
      ) {
        requirementsWithToolOutput +=
          1;

        toolOutputAlternativeCount +=
          edges.length;
      }

      toolsWithRequirements.add(
        tool.metadata.slug,
      );

      requirements.push({
        id: field.fieldId,
        toolSlug:
          tool.metadata.slug,
        inputPath:
          field.jsonPath,
        fieldName:
          field.originalFieldName,
        jsonTypes: [
          ...field.jsonTypes,
        ].sort(compareStrings),
        canonicalEntity:
          field.canonicalEntity
            ?.entity ?? null,
        effectivelyRequired:
          true,
        alternatives,
      });
    }
  }

  requirements.sort(
    (left, right) =>
      compareStrings(
        left.id,
        right.id,
      ),
  );

  return {
    format:
      "tool-input-requirements-v1",
    generatedFrom: {
      catalogFormat:
        catalog.format,
      catalogToolCount:
        catalog.tools.length,
      graphFormat:
        graph.format,
      graphEdgeCount:
        graph.edges.length,
    },
    summary: {
      requiredInputCount:
        requirements.length,
      toolsWithRequiredInputs:
        toolsWithRequirements.size,
      requirementsWithToolOutput,
      requirementsWithoutToolOutput:
        requirements.length -
        requirementsWithToolOutput,
      userAlternativeCount:
        requirements.length,
      priorContextAlternativeCount:
        requirements.length,
      toolOutputAlternativeCount,
    },
    requirements,
  };
}
