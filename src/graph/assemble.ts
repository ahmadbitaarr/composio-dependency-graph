import type {
  CompactCandidateRecord,
  CompactEndpoint,
  DecisionArtifact,
} from "../matching";

export type DependencyGraphNode = {
  id: string;
  toolSlug: string;
  direction: "input" | "output";
  path: string;
  fieldName: string;
  jsonTypes: string[];
  canonicalEntity: string | null;
  canonicalConfidence: string | null;
  effectivelyRequired: boolean;
  toolkit: string;
  service: string;
  resourceFamily: string;
  protocol: string;
  deprecated: boolean;
  schemaCompleteness: string;
};

export type DependencyGraphEdge = {
  id: string;
  from: string;
  to: string;
  producerTool: string;
  consumerTool: string;
  matchedCanonicalEntity: string | null;
  primaryReason:
    CompactCandidateRecord["primaryReason"];
  reasonCodes: string[];
  selectionRequired: boolean;
  transformationRequired: boolean;
  disambiguationRequired: boolean;
  scope: {
    status:
      CompactCandidateRecord[
        "checks"
      ]["scopeStatus"];
    producerEntities: string[];
    consumerEntities: string[];
    sharedEntities: string[];
  };
};

export type DependencyGraphArtifact = {
  format:
    "tool-dependency-graph-v1";
  generatedFrom: {
    acceptedArtifactFormat:
      DecisionArtifact["format"];
    acceptedDecision: "ACCEPTED";
    acceptedCandidateCount: number;
    catalogFormat: string;
    catalogToolCount: number;
    toolkitCounts:
      Record<string, number>;
    toolkitVersions:
      Record<string, string>;
  };
  summary: {
    nodeCount: number;
    edgeCount: number;
    participatingToolCount: number;
    producerNodeCount: number;
    consumerNodeCount: number;
    toolkitPairCounts:
      Record<string, number>;
    servicePairCounts:
      Record<string, number>;
    canonicalEntityCounts:
      Record<string, number>;
    selectionRequiredEdges:
      number;
    transformationRequiredEdges:
      number;
    disambiguationRequiredEdges:
      number;
  };
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
};

function increment(
  counts: Record<string, number>,
  key: string,
): void {
  counts[key] =
    (counts[key] ?? 0) + 1;
}

function graphNode(
  endpoint: CompactEndpoint,
  direction:
    | "input"
    | "output",
): DependencyGraphNode {
  return {
    id: endpoint.fieldId,
    toolSlug:
      endpoint.toolSlug,
    direction,
    path: endpoint.path,
    fieldName:
      endpoint.fieldName,
    jsonTypes: [
      ...endpoint.jsonTypes,
    ].sort(),
    canonicalEntity:
      endpoint.canonicalEntity,
    canonicalConfidence:
      endpoint
        .canonicalConfidence,
    effectivelyRequired:
      endpoint
        .effectivelyRequired,
    toolkit: endpoint.toolkit,
    service: endpoint.service,
    resourceFamily:
      endpoint.resourceFamily,
    protocol:
      endpoint.protocol,
    deprecated:
      endpoint.deprecated,
    schemaCompleteness:
      endpoint
        .schemaCompleteness,
  };
}

function graphEdge(
  candidate:
    CompactCandidateRecord,
): DependencyGraphEdge {
  return {
    id: candidate.id,
    from:
      candidate.producer
        .fieldId,
    to:
      candidate.consumer
        .fieldId,
    producerTool:
      candidate.producer
        .toolSlug,
    consumerTool:
      candidate.consumer
        .toolSlug,
    matchedCanonicalEntity:
      candidate
        .matchedCanonicalEntity,
    primaryReason:
      candidate.primaryReason,
    reasonCodes: [
      ...candidate.reasonCodes,
    ],
    selectionRequired:
      candidate
        .selectionRequired,
    transformationRequired:
      candidate
        .transformationRequired,
    disambiguationRequired:
      candidate
        .disambiguationRequired,
    scope: {
      status:
        candidate.checks
          .scopeStatus,
      producerEntities: [
        ...candidate.checks
          .producerScopeEntities,
      ],
      consumerEntities: [
        ...candidate.checks
          .consumerScopeEntities,
      ],
      sharedEntities: [
        ...candidate.checks
          .sharedScopeEntities,
      ],
    },
  };
}

function addNode(
  nodes:
    Map<
      string,
      DependencyGraphNode
    >,
  node:
    DependencyGraphNode,
): void {
  const existing =
    nodes.get(node.id);

  if (!existing) {
    nodes.set(
      node.id,
      node,
    );
    return;
  }

  if (
    JSON.stringify(existing) !==
    JSON.stringify(node)
  ) {
    throw new Error(
      `Conflicting graph node metadata: ${node.id}`,
    );
  }
}

export function assembleDependencyGraph(
  accepted:
    DecisionArtifact,
): DependencyGraphArtifact {
  if (
    accepted.format !==
    "dependency-candidate-decisions-v1"
  ) {
    throw new Error(
      `Unsupported accepted artifact format: ${accepted.format}`,
    );
  }

  if (
    accepted.decision !==
    "ACCEPTED"
  ) {
    throw new Error(
      "Graph assembly requires the ACCEPTED decision artifact.",
    );
  }

  if (
    accepted.summary
      .candidateCount !==
    accepted.candidates.length
  ) {
    throw new Error(
      "Accepted candidate count does not match the artifact summary.",
    );
  }

  const candidateIds =
    accepted.candidates.map(
      (candidate) =>
        candidate.id,
    );

  if (
    new Set(candidateIds).size !==
    candidateIds.length
  ) {
    throw new Error(
      "Accepted artifact contains duplicate candidate IDs.",
    );
  }

  const nodeById =
    new Map<
      string,
      DependencyGraphNode
    >();

  const edges =
    accepted.candidates.map(
      (candidate) => {
        addNode(
          nodeById,
          graphNode(
            candidate.producer,
            "output",
          ),
        );

        addNode(
          nodeById,
          graphNode(
            candidate.consumer,
            "input",
          ),
        );

        return graphEdge(
          candidate,
        );
      },
    );

  edges.sort(
    (left, right) =>
      left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
  );

  const nodes = [
    ...nodeById.values(),
  ].sort(
    (left, right) =>
      left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
  );

  const toolkitPairCounts:
    Record<string, number> =
    {};

  const servicePairCounts:
    Record<string, number> =
    {};

  const canonicalEntityCounts:
    Record<string, number> =
    {};

  const participatingTools =
    new Set<string>();

  let selectionRequiredEdges =
    0;

  let transformationRequiredEdges =
    0;

  let disambiguationRequiredEdges =
    0;

  for (
    const candidate
    of accepted.candidates
  ) {
    participatingTools.add(
      candidate.producer
        .toolSlug,
    );

    participatingTools.add(
      candidate.consumer
        .toolSlug,
    );

    increment(
      toolkitPairCounts,
      `${candidate.producer.toolkit}->${candidate.consumer.toolkit}`,
    );

    increment(
      servicePairCounts,
      `${candidate.producer.service}->${candidate.consumer.service}`,
    );

    increment(
      canonicalEntityCounts,
      candidate
        .matchedCanonicalEntity ??
        candidate.consumer
          .canonicalEntity ??
        candidate.producer
          .canonicalEntity ??
        "unknown",
    );

    if (
      candidate
        .selectionRequired
    ) {
      selectionRequiredEdges +=
        1;
    }

    if (
      candidate
        .transformationRequired
    ) {
      transformationRequiredEdges +=
        1;
    }

    if (
      candidate
        .disambiguationRequired
    ) {
      disambiguationRequiredEdges +=
        1;
    }
  }

  const producerNodeCount =
    nodes.filter(
      (node) =>
        node.direction ===
        "output",
    ).length;

  const consumerNodeCount =
    nodes.filter(
      (node) =>
        node.direction ===
        "input",
    ).length;

  return {
    format:
      "tool-dependency-graph-v1",
    generatedFrom: {
      acceptedArtifactFormat:
        accepted.format,
      acceptedDecision:
        "ACCEPTED",
      acceptedCandidateCount:
        accepted.candidates
          .length,
      catalogFormat:
        accepted.generatedFrom
          .catalogFormat,
      catalogToolCount:
        accepted.generatedFrom
          .toolCount,
      toolkitCounts: {
        ...accepted
          .generatedFrom
          .toolkitCounts,
      },
      toolkitVersions: {
        ...accepted
          .generatedFrom
          .toolkitVersions,
      },
    },
    summary: {
      nodeCount:
        nodes.length,
      edgeCount:
        edges.length,
      participatingToolCount:
        participatingTools.size,
      producerNodeCount,
      consumerNodeCount,
      toolkitPairCounts,
      servicePairCounts,
      canonicalEntityCounts,
      selectionRequiredEdges,
      transformationRequiredEdges,
      disambiguationRequiredEdges,
    },
    nodes,
    edges,
  };
}
