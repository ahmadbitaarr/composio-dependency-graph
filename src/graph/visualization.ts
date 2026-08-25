import type {
  DependencyGraphArtifact,
} from "./assemble";

export type ToolVisualizationNode = {
  id: string;
  toolkit: string;
  service: string;
  incomingFieldEdges: number;
  outgoingFieldEdges: number;
};

export type ToolVisualizationEdge = {
  id: string;
  from: string;
  to: string;
  acceptedFieldEdgeCount: number;
  canonicalEntities: string[];
};

export type ToolVisualizationArtifact = {
  format:
    "tool-dependency-visualization-v1";
  generatedFrom: {
    graphFormat:
      DependencyGraphArtifact["format"];
    graphNodeCount: number;
    graphEdgeCount: number;
  };
  summary: {
    toolNodeCount: number;
    toolEdgeCount: number;
    acceptedFieldEdgeCount: number;
  };
  nodes: ToolVisualizationNode[];
  edges: ToolVisualizationEdge[];
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

export function buildToolVisualization(
  graph:
    DependencyGraphArtifact,
): ToolVisualizationArtifact {
  if (
    graph.format !==
    "tool-dependency-graph-v1"
  ) {
    throw new Error(
      `Unsupported graph format: ${graph.format}`,
    );
  }

  const metadataByTool =
    new Map<
      string,
      {
        toolkit: string;
        service: string;
      }
    >();

  for (
    const node
    of graph.nodes
  ) {
    const existing =
      metadataByTool.get(
        node.toolSlug,
      );

    const metadata = {
      toolkit: node.toolkit,
      service: node.service,
    };

    if (
      existing &&
      (
        existing.toolkit !==
          metadata.toolkit ||
        existing.service !==
          metadata.service
      )
    ) {
      throw new Error(
        `Conflicting metadata for tool ${node.toolSlug}`,
      );
    }

    metadataByTool.set(
      node.toolSlug,
      metadata,
    );
  }

  const incoming =
    new Map<string, number>();

  const outgoing =
    new Map<string, number>();

  const aggregated =
    new Map<
      string,
      {
        from: string;
        to: string;
        count: number;
        entities: Set<string>;
      }
    >();

  for (
    const edge
    of graph.edges
  ) {
    if (
      !metadataByTool.has(
        edge.producerTool,
      ) ||
      !metadataByTool.has(
        edge.consumerTool,
      )
    ) {
      throw new Error(
        `Missing tool metadata for edge ${edge.id}`,
      );
    }

    outgoing.set(
      edge.producerTool,
      (
        outgoing.get(
          edge.producerTool,
        ) ?? 0
      ) + 1,
    );

    incoming.set(
      edge.consumerTool,
      (
        incoming.get(
          edge.consumerTool,
        ) ?? 0
      ) + 1,
    );

    const id =
      `${edge.producerTool}=>${edge.consumerTool}`;

    const existing =
      aggregated.get(id) ?? {
        from: edge.producerTool,
        to: edge.consumerTool,
        count: 0,
        entities:
          new Set<string>(),
      };

    existing.count += 1;

    if (
      edge.matchedCanonicalEntity
    ) {
      existing.entities.add(
        edge.matchedCanonicalEntity,
      );
    }

    aggregated.set(
      id,
      existing,
    );
  }

  const nodes =
    [
      ...metadataByTool
        .entries(),
    ]
      .map(
        (
          [
            id,
            metadata,
          ],
        ): ToolVisualizationNode => ({
          id,
          toolkit:
            metadata.toolkit,
          service:
            metadata.service,
          incomingFieldEdges:
            incoming.get(id) ?? 0,
          outgoingFieldEdges:
            outgoing.get(id) ?? 0,
        }),
      )
      .sort(
        (left, right) =>
          compareStrings(
            left.id,
            right.id,
          ),
      );

  const edges =
    [
      ...aggregated
        .entries(),
    ]
      .map(
        (
          [
            id,
            value,
          ],
        ): ToolVisualizationEdge => ({
          id,
          from: value.from,
          to: value.to,
          acceptedFieldEdgeCount:
            value.count,
          canonicalEntities:
            [
              ...value.entities,
            ].sort(
              compareStrings,
            ),
        }),
      )
      .sort(
        (left, right) =>
          compareStrings(
            left.id,
            right.id,
          ),
      );

  const acceptedFieldEdgeCount =
    edges.reduce(
      (
        total,
        edge,
      ) =>
        total +
        edge.acceptedFieldEdgeCount,
      0,
    );

  if (
    acceptedFieldEdgeCount !==
    graph.edges.length
  ) {
    throw new Error(
      "Visualization aggregation lost dependency edges.",
    );
  }

  return {
    format:
      "tool-dependency-visualization-v1",
    generatedFrom: {
      graphFormat:
        graph.format,
      graphNodeCount:
        graph.nodes.length,
      graphEdgeCount:
        graph.edges.length,
    },
    summary: {
      toolNodeCount:
        nodes.length,
      toolEdgeCount:
        edges.length,
      acceptedFieldEdgeCount,
    },
    nodes,
    edges,
  };
}
