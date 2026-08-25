export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type ToolkitSlug = "googlesuper" | "github";

export type SchemaDirection = "input" | "output";

export type SchemaCompleteness =
  | "COMPLETE"
  | "PARTIAL"
  | "GENERIC"
  | "MISSING";

export type ProtocolStyle =
  | "REST"
  | "GRAPHQL"
  | "COMPOSIO_CONVENIENCE_HELPER"
  | "UNKNOWN";

export type AbstractionLevel =
  | "PRIMITIVE"
  | "RESOURCE_OPERATION"
  | "CONVENIENCE_WORKFLOW"
  | "UNKNOWN";

export type ApiLifecycle =
  | "CURRENT"
  | "LEGACY"
  | "BETA"
  | "DEPRECATED"
  | "UNKNOWN";

export type CompositionKind = "allOf" | "anyOf" | "oneOf";

export type CanonicalEntityConfidence =
  | "HIGH"
  | "MEDIUM"
  | "LOW";

export type ScopeKind =
  | "account"
  | "owner"
  | "repository"
  | "organization"
  | "team"
  | "environment"
  | "workflow"
  | "calendar"
  | "spreadsheet"
  | "shared_drive"
  | "global"
  | "unknown";

export type RelationshipType =
  | "VALUE"
  | "RESOLUTION"
  | "STATE"
  | "AUTHORIZATION"
  | "POLICY";

export type ValueSource =
  | "USER"
  | "PRIOR_CONTEXT"
  | "TOOL_OUTPUT"
  | "CREATED_RESOURCE"
  | "COMPUTED_VALUE";

export type IdentityKind =
  | "ID"
  | "REST_ID"
  | "GRAPHQL_NODE_ID"
  | "NUMBER"
  | "NAME"
  | "SLUG"
  | "SHA"
  | "REF"
  | "EMAIL"
  | "TOKEN"
  | "UNKNOWN";

export type RawSourceReference = {
  rawFile: string;
  snapshotFormat: string;
  pageIndex: number;
  itemIndex: number;
  toolSlug: string;
  schemaLocation?:
    | "input_parameters"
    | "output_parameters"
    | "inputParameters"
    | "outputParameters";
  schemaPointer?: string;
};

export type ResourceScope = {
  kind: ScopeKind;

  /**
   * Exact normalized field path that supplies the scope value.
   * Example: $.owner or $.repo.
   */
  valueSourcePath?: string;

  /**
   * A literal scope value, when one is already known.
   * Usually omitted during schema normalization.
   */
  value?: string;

  requiredForIdentity: boolean;
  evidence: string[];
};

export type SchemaConstraints = {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  additionalProperties?: boolean | JsonObject;
};

export type CompositionEvidence = {
  kind: CompositionKind;
  branchIndex: number;

  /**
   * Exact path to the composition keyword in the source schema.
   */
  sourceSchemaPath: string;

  /**
   * Original branch fragment preserved as evidence.
   */
  schemaFragment: JsonValue;
};

export type CanonicalEntityAssignment = {
  entity: string;
  confidence: CanonicalEntityConfidence;
  evidence: string[];
  reasonCodes: string[];
};

export type ValueSourceOption = {
  source: ValueSource;
  reason: string;
  preferred: boolean;
};

export type NormalizedSchemaField = {
  /**
   * Stable identifier, normally:
   * `${toolSlug}:${direction}:${jsonPath}`
   */
  fieldId: string;

  toolSlug: string;
  direction: SchemaDirection;

  /**
   * Runtime JSON value path with resolved reference hops removed.
   * Examples:
   * $.data.messages[].id
   * $.data.workflow_runs[].run_number
   */
  jsonPath: string;

  /**
   * Exact path traversed inside the original JSON Schema.
   * This preserves properties, items, $defs, and composition branches.
   */
  sourceSchemaPath: string;

  originalFieldName: string;
  parentPath: string | null;

  jsonTypes: string[];

  /**
   * True when the field is listed in its immediate parent schema's
   * required array or a flat parameter declares required=true.
   */
  requiredAtParent: boolean;

  /**
   * True only when every parent needed to reach this field is also
   * required.
   */
  effectivelyRequired: boolean;

  nullable: boolean;
  isArray: boolean;
  arrayDepth: number;
  itemTypes: string[];

  description: string;
  enumValues: JsonValue[];

  hasDefault: boolean;
  defaultValue?: JsonValue;

  format: string | null;
  constraints: SchemaConstraints;

  /**
   * Reference written on the original field fragment.
   */
  ref: string | null;

  refResolved: boolean;

  /**
   * Ordered local-reference chain followed to expose this field.
   */
  refTrace: string[];

  compositions: CompositionEvidence[];

  /**
   * Original field-level schema fragment.
   */
  rawSchemaFragment: JsonValue;

  safeForInference: boolean;
  safetyReasons: string[];

  canonicalEntity?: CanonicalEntityAssignment;

  /**
   * A field may be obtainable from several sources.
   */
  possibleValueSources: ValueSourceOption[];

  /**
   * Resource scopes required to interpret this field safely.
   */
  scopes: ResourceScope[];
};

export type NormalizedToolMetadata = {
  slug: string;
  name: string;
  description: string;

  toolkit: ToolkitSlug;
  toolkitVersion: string | null;
  availableToolkitVersions: string[];

  underlyingService: string;
  resourceFamily: string;
  actionFamily: string;

  deprecated: boolean;
  legacy: boolean;
  beta: boolean;
  lifecycle: ApiLifecycle;

  apiGeneration: string;
  apiVariant: string;

  protocol: ProtocolStyle;
  abstractionLevel: AbstractionLevel;

  inputSchemaCompleteness: SchemaCompleteness;
  outputSchemaCompleteness: SchemaCompleteness;

  oauthScopes: string[];
  resourceScopes: ResourceScope[];
  tags: string[];

  rawSource: RawSourceReference;
};

export type NormalizedTool = {
  metadata: NormalizedToolMetadata;
  inputFields: NormalizedSchemaField[];
  outputFields: NormalizedSchemaField[];

  unresolvedReferences: string[];
  unsupportedSchemaFeatures: string[];
  warnings: string[];
};

export type NormalizedCatalogSummary = {
  toolCount: number;
  inputFieldCount: number;
  outputFieldCount: number;

  toolsByToolkit: Record<string, number>;
  toolsByService: Record<string, number>;
  toolsByResourceFamily: Record<string, number>;

  schemaCompleteness: Record<SchemaCompleteness, number>;
  abstractionLevels: Record<AbstractionLevel, number>;

  deprecatedToolCount: number;
  legacyToolCount: number;
  betaToolCount: number;

  canonicalEntityAssignments: number;
  deliberatelyUnclassifiedFields: number;
  warningCount: number;
};

export type NormalizedToolCatalog = {
  format: "normalized-tool-catalog-v1";
  generatedAt: string;

  sourceFiles: Array<{
    toolkit: ToolkitSlug;
    path: string;
    toolkitVersion: string | null;
    toolCount: number;
  }>;

  tools: NormalizedTool[];
  summary: NormalizedCatalogSummary;
};

export type RelationshipFieldReference = {
  toolSlug: string;
  fieldId: string;
  jsonPath: string;
  canonicalEntity?: string;
  scopes: ResourceScope[];
};

/**
 * Contract for later phases only.
 * Defining this type does not create a dependency edge.
 */
export type RelationshipContract = {
  id: string;
  type: RelationshipType;

  source: RelationshipFieldReference;
  target: RelationshipFieldReference;

  evidence: string[];
  assumptions: string[];
  safeForAutomaticUse: boolean;
};

export type CanonicalEntityAliases = {
  exactFieldNames: string[];
  contextualFieldNames: string[];
  descriptionPatterns: string[];
};

export type CanonicalEntityDefinition = {
  id: string;
  service: string;
  resourceFamily: string;
  identityKind: IdentityKind;
  jsonTypes: string[];

  aliases: CanonicalEntityAliases;

  scopeKinds: ScopeKind[];
  allowedProtocols: ProtocolStyle[];

  /**
   * When true, a generic name such as id, number, name, ref, or sha
   * cannot be classified without resource evidence.
   */
  requiresResourceContext: boolean;

  incompatibleEntities: string[];
  notes: string[];
};

export type GenericFieldPolicy = {
  blockedWithoutContext: string[];
  requiredEvidence: string[];
};

export type OntologyDocument = {
  format: "dependency-ontology-v1";
  version: string;
  description: string;

  genericFieldPolicy: GenericFieldPolicy;
  entities: CanonicalEntityDefinition[];

  hardSeparations: Array<{
    left: string;
    right: string;
    reason: string;
  }>;
};