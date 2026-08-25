import {
  createHash,
} from "node:crypto";

import type {
  CompactCandidateRecord,
} from "../matching";
import type {
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
} from "../types";
import {
  createEligibilityContext,
  resolveCandidateEvidence,
  type EligibilityContext,
} from "./eligibility";

export type DuplicateCluster = {
  semanticCluster: string;
  representativeId: string;
  candidateIds: string[];
};

export type DeduplicationResult = {
  retained: CompactCandidateRecord[];
  clusters: DuplicateCluster[];
  duplicateOf: Record<string, string>;
};

export type SemanticHashContext =
  EligibilityContext;

export function createSemanticHashContext(
  catalog: NormalizedToolCatalog,
): SemanticHashContext {
  return createEligibilityContext(catalog);
}

function normalizeText(
  value: string,
): string {
  return value
    .toLowerCase()
    .replace(
      /https?:\/\/\S+/g,
      "<url>",
    )
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sorted(
  values: string[],
): string[] {
  return [...values].sort();
}

function fieldSignature(
  field: NormalizedSchemaField,
): object {
  return {
    fieldName:
      field.originalFieldName
        .toLowerCase(),
    jsonTypes: sorted(field.jsonTypes),
    arrayDepth: field.arrayDepth,
    required: field.effectivelyRequired,
    description:
      normalizeText(field.description),
    canonicalEntity:
      field.canonicalEntity?.entity ??
      null,
    canonicalConfidence:
      field.canonicalEntity
        ?.confidence ?? null,
    canonicalReasons: sorted(
      field.canonicalEntity
        ?.reasonCodes ?? [],
    ),
    safeForInference:
      field.safeForInference,
    safetyReasons: sorted(
      field.safetyReasons,
    ),
    scopes: field.scopes
      .map((scope) => ({
        kind: scope.kind,
        requiredForIdentity:
          scope.requiredForIdentity,
        valueSourcePath:
          scope.valueSourcePath ??
          null,
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(
          JSON.stringify(right),
        ),
      ),
    compositions:
      field.compositions
        .map((composition) => ({
          kind: composition.kind,
          branchIndex:
            composition.branchIndex,
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(
            JSON.stringify(right),
          ),
        ),
  };
}

function toolSignature(
  tool: NormalizedTool,
  direction: "producer" | "consumer",
): object {
  return {
    toolkit: tool.metadata.toolkit,
    toolkitVersion:
      tool.metadata.toolkitVersion,
    service:
      tool.metadata.underlyingService,
    resourceFamily:
      tool.metadata.resourceFamily,
    actionFamily:
      tool.metadata.actionFamily,
    protocol: tool.metadata.protocol,
    apiVariant:
      tool.metadata.apiVariant,
    abstractionLevel:
      tool.metadata.abstractionLevel,
    deprecated:
      tool.metadata.deprecated,
    schemaCompleteness:
      direction === "producer"
        ? tool.metadata
            .outputSchemaCompleteness
        : tool.metadata
            .inputSchemaCompleteness,
  };
}

export function semanticCandidateHashWithContext(
  candidate: CompactCandidateRecord,
  context: SemanticHashContext,
): string {
  const evidence =
    resolveCandidateEvidence(
      candidate,
      context,
    );

  if (
    !evidence.producerTool ||
    !evidence.consumerTool ||
    !evidence.producerField ||
    !evidence.consumerField
  ) {
    throw new Error(
      `Cannot create semantic signature for unresolved candidate ${candidate.id}`,
    );
  }

  const signature = {
    primaryReason:
      candidate.primaryReason,
    generationReasons: sorted(
      candidate.generationReasons,
    ),
    matchedCanonicalEntity:
      candidate.matchedCanonicalEntity,
    selectionRequired:
      candidate.selectionRequired,
    disambiguationRequired:
      candidate.disambiguationRequired,
    transformationRequired:
      candidate.transformationRequired,
    checks: {
      entityCompatible:
        candidate.checks
          .entityCompatible,
      typeCompatible:
        candidate.checks
          .typeCompatible,
      serviceCompatible:
        candidate.checks
          .serviceCompatible,
      protocolIdentityCompatible:
        candidate.checks
          .protocolIdentityCompatible,
      producerAddsNewInformation:
        candidate.checks
          .producerAddsNewInformation,
      scopeStatus:
        candidate.checks.scopeStatus,
      producerScopeEntities: sorted(
        candidate.checks
          .producerScopeEntities,
      ),
      consumerScopeEntities: sorted(
        candidate.checks
          .consumerScopeEntities,
      ),
      sharedScopeEntities: sorted(
        candidate.checks
          .sharedScopeEntities,
      ),
    },
    producer: {
      tool: toolSignature(
        evidence.producerTool,
        "producer",
      ),
      field: fieldSignature(
        evidence.producerField,
      ),
    },
    consumer: {
      tool: toolSignature(
        evidence.consumerTool,
        "consumer",
      ),
      field: fieldSignature(
        evidence.consumerField,
      ),
    },
  };

  return createHash("sha256")
    .update(JSON.stringify(signature))
    .digest("hex");
}

export function semanticCandidateHash(
  candidate: CompactCandidateRecord,
  catalog: NormalizedToolCatalog,
): string {
  return semanticCandidateHashWithContext(
    candidate,
    createSemanticHashContext(catalog),
  );
}

export function deduplicateEligibleCandidates(
  candidates: CompactCandidateRecord[],
  catalog: NormalizedToolCatalog,
): DeduplicationResult {
  const context =
  createSemanticHashContext(catalog);
  const groups = new Map<
    string,
    CompactCandidateRecord[]
  >();

  for (
    const candidate of
    [...candidates].sort(
      (left, right) =>
        left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0,
    )
  ) {
    const hash =
      semanticCandidateHashWithContext(
        candidate,
        context,
      );

    const group =
      groups.get(hash) ?? [];

    group.push(candidate);
    groups.set(hash, group);
  }

  const retained:
    CompactCandidateRecord[] = [];

  const clusters:
    DuplicateCluster[] = [];

  const duplicateOf:
    Record<string, string> = {};

  for (
    const [semanticCluster, group]
    of [...groups.entries()].sort(
      ([left], [right]) =>
        left < right
          ? -1
          : left > right
            ? 1
            : 0,
    )
  ) {
    group.sort((left, right) =>
      left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
    );

    const representative = group[0];

    retained.push(representative);

    if (group.length <= 1) {
      continue;
    }

    const candidateIds =
      group.map(
        (candidate) => candidate.id,
      );

    clusters.push({
      semanticCluster,
      representativeId:
        representative.id,
      candidateIds,
    });

    for (
      const duplicate of group.slice(1)
    ) {
      duplicateOf[duplicate.id] =
        representative.id;
    }
  }

  retained.sort((left, right) =>
    left.id < right.id
      ? -1
      : left.id > right.id
        ? 1
        : 0,
  );

  clusters.sort((left, right) =>
    left.representativeId <
    right.representativeId
      ? -1
      : left.representativeId >
          right.representativeId
        ? 1
        : 0,
  );

  return {
    retained,
    clusters,
    duplicateOf,
  };
}