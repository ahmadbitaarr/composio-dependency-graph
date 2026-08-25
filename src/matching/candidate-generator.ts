import type {
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
  OntologyDocument,
} from "../types";
import type {
  CandidateEndpoint,
  CandidateGenerationReason,
  DependencyCandidate,
  IndexedField,
} from "./types";

type HardSeparation = {
  left: string;
  right: string;
  reason: string;
};

type MatchingOntology = OntologyDocument & {
  hardSeparations?: HardSeparation[];
};

type AddCandidateOptions = {
  hardSeparation?: HardSeparation | null;
  requireCompatibleTypes?: boolean;
};

const GENERIC_IDENTITY_NAMES = new Set([
  "id",
  "number",
  "nodeid",
]);

const CONTACT_RECIPIENT_NAMES = new Set([
  "recipientemail",
  "recipient",
  "to",
]);

const FOREIGN_RESOURCE_PARENT_PATTERN =
  /actor|author|uploader|invitee|assignee|reviewer|creator|organizer|attendee|user|owner|license|milestone|step|job|asset|member|collaborator/i;

function normalizedName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function scalarKinds(
  field: NormalizedSchemaField,
): Set<string> {
  const result = new Set<string>();

  for (const type of field.jsonTypes) {
    if (type === "integer" || type === "number") {
      result.add("number");
    } else if (
      type === "string" ||
      type === "boolean"
    ) {
      result.add(type);
    }
  }

  return result;
}

export function jsonTypesCompatible(
  producer: NormalizedSchemaField,
  consumer: NormalizedSchemaField,
): boolean {
  const producerKinds = scalarKinds(producer);
  const consumerKinds = scalarKinds(consumer);

  if (
    producerKinds.size === 0 ||
    consumerKinds.size === 0
  ) {
    return false;
  }

  return [...producerKinds].some((kind) =>
    consumerKinds.has(kind),
  );
}

function isScalar(
  field: NormalizedSchemaField,
): boolean {
  return scalarKinds(field).size > 0;
}

function entityOf(
  field: NormalizedSchemaField,
): string | null {
  return field.canonicalEntity?.entity ?? null;
}

function isTrustedProducer(
  field: NormalizedSchemaField,
): boolean {
  return (
    isScalar(field) &&
    field.safeForInference &&
    field.canonicalEntity?.confidence === "HIGH"
  );
}

function isUsableCanonicalConsumer(
  field: NormalizedSchemaField,
): boolean {
  return (
    isScalar(field) &&
    field.effectivelyRequired &&
    field.canonicalEntity !== undefined
  );
}

function endpoint(
  tool: NormalizedTool,
  field: NormalizedSchemaField,
): CandidateEndpoint {
  const schemaCompleteness =
    field.direction === "input"
      ? tool.metadata.inputSchemaCompleteness
      : tool.metadata.outputSchemaCompleteness;

  return {
    toolSlug: tool.metadata.slug,
    fieldId: field.fieldId,
    path: field.jsonPath,
    fieldName: field.originalFieldName,
    jsonTypes: [...field.jsonTypes],
    canonicalEntity: entityOf(field),
    canonicalConfidence:
      field.canonicalEntity?.confidence ?? null,
    safeForInference: field.safeForInference,
    arrayDepth: field.arrayDepth,
    effectivelyRequired:
      field.effectivelyRequired,
    toolkit: tool.metadata.toolkit,
    service:
      tool.metadata.underlyingService,
    resourceFamily:
      tool.metadata.resourceFamily,
    protocol: tool.metadata.protocol,
    apiGeneration:
      tool.metadata.apiGeneration,
    abstractionLevel:
      tool.metadata.abstractionLevel,
    deprecated: tool.metadata.deprecated,
    schemaCompleteness,
  };
}

export function candidateId(
  producer: IndexedField,
  consumer: IndexedField,
): string {
  return (
    `${producer.field.fieldId}` +
    `=>${consumer.field.fieldId}`
  );
}

function indexPush<K>(
  index: Map<K, IndexedField[]>,
  key: K,
  value: IndexedField,
): void {
  const current = index.get(key);

  if (current) {
    current.push(value);
  } else {
    index.set(key, [value]);
  }
}

function serviceTypeKeys(
  service: string,
  field: NormalizedSchemaField,
): string[] {
  return [...scalarKinds(field)].map(
    (kind) => `${service}:${kind}`,
  );
}

function hardSeparationKey(
  left: string,
  right: string,
): string {
  return [left, right].sort().join("::");
}

function addCandidate(
  result: Map<string, DependencyCandidate>,
  producer: IndexedField,
  consumer: IndexedField,
  reason: CandidateGenerationReason,
  options: AddCandidateOptions = {},
): void {
  const requireCompatibleTypes =
    options.requireCompatibleTypes ?? true;

  if (
    requireCompatibleTypes &&
    !jsonTypesCompatible(
      producer.field,
      consumer.field,
    )
  ) {
    return;
  }

  const id = candidateId(producer, consumer);
  const existing = result.get(id);

  if (existing) {
    if (
      !existing.generationReasons.includes(reason)
    ) {
      existing.generationReasons.push(reason);
      existing.generationReasons.sort();
    }

    if (
      !existing.hardSeparation &&
      options.hardSeparation
    ) {
      existing.hardSeparation =
        options.hardSeparation;
    }

    return;
  }

  const producerEntity =
    entityOf(producer.field);

  const consumerEntity =
    entityOf(consumer.field);

  result.set(id, {
    id,
    producer: endpoint(
      producer.tool,
      producer.field,
    ),
    consumer: endpoint(
      consumer.tool,
      consumer.field,
    ),
    generationReasons: [reason],
    matchedCanonicalEntity:
      producerEntity &&
      producerEntity === consumerEntity
        ? producerEntity
        : null,
    hardSeparation:
      options.hardSeparation ?? null,
  });
}

function toolMentionsBothIssueAndPullRequest(
  tool: NormalizedTool,
): boolean {
  const text = [
    tool.metadata.slug,
    tool.metadata.name,
    tool.metadata.description,
  ]
    .join(" ")
    .toLowerCase();

  return (
    /issue/.test(text) &&
    /pull request|pull_request|\bpr\b/.test(text)
  );
}

function hasForeignNestedResource(
  field: NormalizedSchemaField,
): boolean {
  if (field.arrayDepth > 0) {
    return false;
  }

  const parent = field.parentPath ?? "";
  const finalParent =
    parent.split(".").at(-1) ?? "";

  return FOREIGN_RESOURCE_PARENT_PATTERN.test(
    finalParent,
  );
}

function isRepositoryFullNameProducer(
  producer: IndexedField,
): boolean {
  return (
    normalizedName(
      producer.field.originalFieldName,
    ) === "fullname" &&
    producer.field.arrayDepth > 0 &&
    producer.tool.metadata
      .underlyingService === "github" &&
    producer.tool.metadata.resourceFamily ===
      "repository" &&
    producer.tool.metadata.abstractionLevel ===
      "CONVENIENCE_WORKFLOW"
  );
}

export function generateDependencyCandidates(
  catalog: NormalizedToolCatalog,
  ontologyInput: OntologyDocument,
): DependencyCandidate[] {
  const ontology =
    ontologyInput as MatchingOntology;

  const consumersByEntity =
    new Map<string, IndexedField[]>();

  const consumersByServiceAndType =
    new Map<string, IndexedField[]>();

  const contactRecipientConsumers:
    IndexedField[] = [];

  const contactEmailProducers:
    IndexedField[] = [];

  const trustedCanonicalProducers:
    IndexedField[] = [];

  const unresolvedScalarProducers:
    IndexedField[] = [];

  for (const tool of catalog.tools) {
    for (const field of tool.inputFields) {
      if (!isScalar(field)) {
        continue;
      }

      const indexed = { tool, field };

      /*
       * Candidate generation is allowed to retain a
       * medium-confidence consumer for later evaluation.
       * This is required for job_id, whose exact input
       * alias is currently MEDIUM but still semantically
       * meaningful.
       */
      if (isUsableCanonicalConsumer(field)) {
        indexPush(
          consumersByEntity,
          field.canonicalEntity!.entity,
          indexed,
        );

        for (const key of serviceTypeKeys(
          tool.metadata.underlyingService,
          field,
        )) {
          indexPush(
            consumersByServiceAndType,
            key,
            indexed,
          );
        }
      }

      const inputName = normalizedName(
        field.originalFieldName,
      );

      /*
      * Gmail recipient fields may be conditionally required:
      * SEND_EMAIL accepts recipient_email, to, cc, or bcc.
      * They must remain eligible for contact-resolution
      * candidates even when not individually required.
      */
      if (
        tool.metadata.underlyingService ===
          "gmail" &&
        CONTACT_RECIPIENT_NAMES.has(inputName) &&
        !field.canonicalEntity
      ) {
        contactRecipientConsumers.push(indexed);
      }
    }

    for (const field of tool.outputFields) {
      if (!isScalar(field)) {
        continue;
      }

      const indexed = { tool, field };

      /*
       * Contact-email outputs may be safe but MEDIUM
       * confidence because a contact can expose multiple
       * addresses. Keep them only for the explicit
       * recipient-disambiguation rule.
       */
      if (
        field.safeForInference &&
        entityOf(field) ===
          "google.contact_email"
      ) {
        contactEmailProducers.push(indexed);
      }

      if (isTrustedProducer(field)) {
        trustedCanonicalProducers.push(
          indexed,
        );
      } else if (!field.canonicalEntity) {
        unresolvedScalarProducers.push(
          indexed,
        );
      }
    }
  }

  const hardSeparationsByPair =
    new Map<string, HardSeparation>();

  const hardPartnersByEntity =
    new Map<string, Set<string>>();

  for (
    const separation of
    ontology.hardSeparations ?? []
  ) {
    hardSeparationsByPair.set(
      hardSeparationKey(
        separation.left,
        separation.right,
      ),
      separation,
    );

    const leftPartners =
      hardPartnersByEntity.get(
        separation.left,
      ) ?? new Set<string>();

    leftPartners.add(separation.right);

    hardPartnersByEntity.set(
      separation.left,
      leftPartners,
    );

    const rightPartners =
      hardPartnersByEntity.get(
        separation.right,
      ) ?? new Set<string>();

    rightPartners.add(separation.left);

    hardPartnersByEntity.set(
      separation.right,
      rightPartners,
    );
  }

  const definitionsById = new Map(
    ontology.entities.map((definition) => [
      definition.id,
      definition,
    ]),
  );

  const result =
    new Map<string, DependencyCandidate>();

  /*
   * Normal candidates are generated only from safe,
   * high-confidence producers to canonical required
   * consumers. This prevents optional fields and broad
   * schema aliases from creating a combinatorial graph.
   */
  for (
    const producer of
    trustedCanonicalProducers
  ) {
    const producerEntity =
      entityOf(producer.field)!;

    for (
      const consumer of
      consumersByEntity.get(
        producerEntity,
      ) ?? []
    ) {
      addCandidate(
        result,
        producer,
        consumer,
        "EXACT_CANONICAL_ENTITY",
      );
    }

    /*
     * Hard separations intentionally bypass JSON-type
     * compatibility. A GraphQL node ID can be a string
     * while the corresponding REST ID is an integer.
     */
    for (
      const partner of
      hardPartnersByEntity.get(
        producerEntity,
      ) ?? []
    ) {
      const separation =
        hardSeparationsByPair.get(
          hardSeparationKey(
            producerEntity,
            partner,
          ),
        ) ?? null;

      for (
        const consumer of
        consumersByEntity.get(partner) ?? []
      ) {
        addCandidate(
          result,
          producer,
          consumer,
          "HARD_SEPARATION_PAIR",
          {
            hardSeparation: separation,
            requireCompatibleTypes: false,
          },
        );
      }
    }

  }

  /*
   * Contact-email outputs are deliberately handled
   * separately from exact canonical matching. Even a
   * safe contact email requires selecting the intended
   * contact/address before filling a Gmail recipient.
   */
  for (
    const producer of contactEmailProducers
  ) {
    for (
      const consumer of
      contactRecipientConsumers
    ) {
      addCandidate(
        result,
        producer,
        consumer,
        "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION",
      );
    }
  }

  /*
   * Unclassified outputs are considered only through
   * narrowly reviewed patterns. Ontology aliases are
   * already applied during normalization and are not
   * re-expanded here.
   */
  for (
    const producer of
    unresolvedScalarProducers
  ) {
    const fieldName = normalizedName(
      producer.field.originalFieldName,
    );

    if (
      isRepositoryFullNameProducer(producer)
    ) {
      for (const entity of [
        "github.repository_name",
        "github.owner",
      ]) {
        for (
          const consumer of
          consumersByEntity.get(entity) ?? []
        ) {
          addCandidate(
            result,
            producer,
            consumer,
            "REPOSITORY_FULL_NAME_TRANSFORMATION",
          );
        }
      }
    }

/*
 * Only fields whose own description says the number
 * may identify either an issue or a pull request are
 * ambiguous. A milestone description may mention that
 * milestones track issues or pull requests, but its
 * number is still a milestone number.
 */
const fieldDescribesIssueOrPullRequestNumber =
  /issue\s+(?:or|and)\s+pull request number|pull request\s+(?:or|and)\s+issue number/i.test(
    producer.field.description,
  );

    if (
      fieldName === "number" &&
      producer.tool.metadata
        .underlyingService === "github" &&
      fieldDescribesIssueOrPullRequestNumber &&
      toolMentionsBothIssueAndPullRequest(
        producer.tool,
      )
    ) {
      for (const entity of [
        "github.issue_number",
        "github.pull_request_number",
      ]) {
        for (
          const consumer of
          consumersByEntity.get(entity) ?? []
        ) {
          addCandidate(
            result,
            producer,
            consumer,
            "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY",
          );
        }
      }
    }

    /*
     * Retain a small class of intentionally unsafe
     * generic IDs for deterministic rejection. Requiring
     * a non-array nested foreign resource prevents every
     * generic id in the catalog from matching every
     * consumer of the outer tool resource.
     */
    if (
      producer.field.safeForInference ||
      !GENERIC_IDENTITY_NAMES.has(
        fieldName,
      ) ||
      !hasForeignNestedResource(
        producer.field,
      )
    ) {
      continue;
    }

    for (const key of serviceTypeKeys(
      producer.tool.metadata
        .underlyingService,
      producer.field,
    )) {
      for (
        const consumer of
        consumersByServiceAndType.get(key) ?? []
      ) {
        const consumerEntity =
          entityOf(consumer.field);

        if (!consumerEntity) {
          continue;
        }

        const definition =
          definitionsById.get(consumerEntity);

        if (
          !definition ||
          producer.tool.metadata
            .resourceFamily !==
            definition.resourceFamily
        ) {
          continue;
        }

        addCandidate(
          result,
          producer,
          consumer,
          "GENERIC_IDENTITY_FIELD",
        );
      }
    }
  }

  return [...result.values()].sort(
    (left, right) => {
      if (left.id < right.id) {
        return -1;
      }

      if (left.id > right.id) {
        return 1;
      }

      return 0;
    },
  );
}
