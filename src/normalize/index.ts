import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AbstractionLevel,
  ApiLifecycle,
  CanonicalEntityDefinition,
  CompositionEvidence,
  JsonValue,
  NormalizedSchemaField,
  NormalizedTool,
  NormalizedToolCatalog,
  NormalizedToolMetadata,
  OntologyDocument,
  ProtocolStyle,
  ResourceScope,
  SchemaCompleteness,
  SchemaConstraints,
  SchemaDirection,
  ScopeKind,
  ToolkitSlug,
} from "../types";

type RawRecord = Record<string, unknown>;

type RawToolLocation = {
  toolkit: ToolkitSlug;
  rawFile: string;
  snapshotFormat: string;
  pageIndex: number;
  itemIndex: number;
  tool: RawRecord;
};

type SchemaWalkResult = {
  fields: NormalizedSchemaField[];
  unresolvedReferences: string[];
  unsupportedSchemaFeatures: string[];
};

type SourceFileResult = {
  toolkit: ToolkitSlug;
  path: string;
  toolkitVersion: string | null;
  tools: RawToolLocation[];
};

const RAW_SOURCES: Array<{ toolkit: ToolkitSlug; path: string }> = [
  { toolkit: "googlesuper", path: "data/raw/googlesuper-tools.json" },
  { toolkit: "github", path: "data/raw/github-tools.json" },
];

const OUTPUT_PATH = "data/normalized-tools.json";
const REPORT_PATH = "docs/normalization-report.md";
const ONTOLOGY_PATH = "data/ontology.json";

async function ensureDirectory(directoryPath: string): Promise<void> {
  try {
    const info = await stat(directoryPath);

    if (!info.isDirectory()) {
      throw new Error(
        `Expected ${directoryPath} to be a directory, but it is not.`,
      );
    }
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;

    if (code !== "ENOENT") {
      throw error;
    }

    await mkdir(directoryPath);
  }
}

const GENERIC_FIELD_NAMES = new Set([
  "id",
  "ids",
  "number",
  "numbers",
  "name",
  "key",
  "token",
  "ref",
  "reference",
  "sha",
  "value",
  "values",
  "data",
  "result",
  "results",
  "item",
  "items",
]);

const ENVELOPE_FIELD_NAMES = new Set([
  "data",
  "error",
  "successful",
  "success",
  "display_url",
  "composio_execution_message",
]);

const INTERNAL_FIELD_PATTERN = /^(composio_|connected_account|connectedAccount|authConfig|auth_config)/i;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function normalizedName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function lowerText(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function appendRuntimePath(base: string, key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return base === "$" ? `$.${key}` : `${base}.${key}`;
  }

  return `${base}[${JSON.stringify(key)}]`;
}

function appendSourcePath(base: string, key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return `${base}.${key}`;
  }

  return `${base}[${JSON.stringify(key)}]`;
}

function lastRuntimeSegment(jsonPath: string): string {
  const withoutArray = jsonPath.replace(/\[\]$/g, "");
  const dot = withoutArray.lastIndexOf(".");

  if (dot >= 0) return withoutArray.slice(dot + 1).replace(/^\["|"\]$/g, "");
  return withoutArray;
}

function parentRuntimePath(jsonPath: string): string | null {
  if (jsonPath === "$") return null;

  const withoutArray = jsonPath.replace(/\[\]$/g, "");
  const dot = withoutArray.lastIndexOf(".");
  if (dot <= 0) return "$";
  return withoutArray.slice(0, dot);
}

function inferTypes(schema: RawRecord): string[] {
  if (typeof schema.type === "string") return [schema.type];

  if (Array.isArray(schema.type)) {
    return schema.type.filter(
      (item): item is string => typeof item === "string",
    );
  }

  if (isRecord(schema.properties)) return ["object"];
  if (schema.items !== undefined) return ["array"];
  if (typeof schema.$ref === "string") return ["$ref"];

  const branchTypes = ["allOf", "anyOf", "oneOf"].flatMap((keyword) => {
    const branches = schema[keyword];
    return Array.isArray(branches)
      ? branches.flatMap((branch) => (isRecord(branch) ? inferTypes(branch) : []))
      : [];
  });

  return unique(branchTypes.length > 0 ? branchTypes : ["unknown"]);
}

function inferItemTypes(schema: RawRecord): string[] {
  if (!isRecord(schema.items)) return [];
  return inferTypes(schema.items);
}

function getConstraints(schema: RawRecord): SchemaConstraints {
  const constraints: SchemaConstraints = {};

  const numericKeys = [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
  ] as const;

  for (const key of numericKeys) {
    if (typeof schema[key] === "number") {
      constraints[key] = schema[key] as never;
    }
  }

  if (typeof schema.pattern === "string") constraints.pattern = schema.pattern;
  if (typeof schema.uniqueItems === "boolean") constraints.uniqueItems = schema.uniqueItems;

  if (typeof schema.additionalProperties === "boolean") {
    constraints.additionalProperties = schema.additionalProperties;
  } else if (isRecord(schema.additionalProperties)) {
    constraints.additionalProperties = toJsonValue(
      schema.additionalProperties,
    ) as Record<string, JsonValue>;
  }

  return constraints;
}

function mergeSchemas(base: RawRecord, overlay: RawRecord): RawRecord {
  const result: RawRecord = { ...base, ...overlay };

  if (isRecord(base.properties) || isRecord(overlay.properties)) {
    result.properties = {
      ...(isRecord(base.properties) ? base.properties : {}),
      ...(isRecord(overlay.properties) ? overlay.properties : {}),
    };
  }

  const required = unique([
    ...asStringArray(base.required),
    ...asStringArray(overlay.required),
  ]);
  if (required.length > 0) result.required = required;

  return result;
}

function removeRef(schema: RawRecord): RawRecord {
  const { $ref: _ignored, ...rest } = schema;
  return rest;
}

function unescapeJsonPointerPart(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function refToSourcePath(ref: string): string | null {
  if (!ref.startsWith("#/")) return null;

  return ref
    .slice(2)
    .split("/")
    .map(unescapeJsonPointerPart)
    .reduce((current, part) => appendSourcePath(current, part), "$");
}

function resolveLocalRef(root: unknown, ref: string): RawRecord | null {
  if (!isRecord(root) || !ref.startsWith("#/")) return null;

  const parts = ref
    .slice(2)
    .split("/")
    .map(unescapeJsonPointerPart);

  let current: unknown = root;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return null;
    current = current[part];
  }

  return isRecord(current) ? current : null;
}

function schemaLocation(
  tool: RawRecord,
  snakeCase: string,
  camelCase: string,
): { location: string | null; schema: unknown } {
  if (tool[snakeCase] !== undefined) {
    return { location: snakeCase, schema: tool[snakeCase] };
  }

  if (tool[camelCase] !== undefined) {
    return { location: camelCase, schema: tool[camelCase] };
  }

  return { location: null, schema: undefined };
}

function normalizeSchemaFields(
  toolSlug: string,
  direction: SchemaDirection,
  schema: unknown,
): SchemaWalkResult {
  if (!isRecord(schema)) {
    return {
      fields: [],
      unresolvedReferences: [],
      unsupportedSchemaFeatures: [],
    };
  }

  const fieldsByPath = new Map<string, NormalizedSchemaField>();
  const unresolvedReferences = new Set<string>();
  const unsupportedSchemaFeatures = new Set<string>();
  const activeRefs = new Set<string>();

  function addOrMerge(field: NormalizedSchemaField): void {
    const existing = fieldsByPath.get(field.jsonPath);

    if (!existing) {
      fieldsByPath.set(field.jsonPath, field);
      return;
    }

    existing.jsonTypes = unique([...existing.jsonTypes, ...field.jsonTypes]);
    existing.itemTypes = unique([...existing.itemTypes, ...field.itemTypes]);
    existing.nullable = existing.nullable || field.nullable;
    existing.isArray = existing.isArray || field.isArray;
    existing.arrayDepth = Math.max(existing.arrayDepth, field.arrayDepth);
    existing.requiredAtParent = existing.requiredAtParent && field.requiredAtParent;
    existing.effectivelyRequired =
      existing.effectivelyRequired && field.effectivelyRequired;
    existing.refResolved = existing.refResolved || field.refResolved;
    existing.refTrace = unique([...existing.refTrace, ...field.refTrace]);
    existing.compositions = [
      ...existing.compositions,
      ...field.compositions.filter(
        (candidate) =>
          !existing.compositions.some(
            (current) =>
              current.kind === candidate.kind &&
              current.branchIndex === candidate.branchIndex &&
              current.sourceSchemaPath === candidate.sourceSchemaPath,
          ),
      ),
    ];

    if (field.description.length > existing.description.length) {
      existing.description = field.description;
    }
  }

  function walk(
    originalSchema: unknown,
    runtimePath: string,
    sourcePath: string,
    requiredAtParent: boolean,
    parentEffectivelyRequired: boolean,
    ancestorArrayDepth: number,
    inheritedRefTrace: string[],
    inheritedCompositions: CompositionEvidence[],
    emitCurrent: boolean,
  ): void {
    if (!isRecord(originalSchema)) return;

    let working = originalSchema;
    let refResolved = false;
    let refTrace = [...inheritedRefTrace];
    let activeRefToRelease: string | null = null;
    let childSourceBase = sourcePath;
    const directRef = asString(originalSchema.$ref);

    if (directRef) {
      if (activeRefs.has(directRef)) {
        unsupportedSchemaFeatures.add(`CYCLIC_REF:${directRef}`);
      } else {
        const target = resolveLocalRef(schema, directRef);

        if (!target) {
          unresolvedReferences.add(directRef);
        } else {
          activeRefs.add(directRef);
          activeRefToRelease = directRef;
          working = mergeSchemas(target, removeRef(originalSchema));
          refTrace = [...refTrace, directRef];
          childSourceBase = refToSourcePath(directRef) ?? sourcePath;
          refResolved = true;
        }
      }
    }

    const branchRootTypes = ["allOf", "anyOf", "oneOf"].flatMap((keyword) => {
      const branches = working[keyword];
      return Array.isArray(branches)
        ? branches.flatMap((branch) => (isRecord(branch) ? inferTypes(branch) : []))
        : [];
    });

    const jsonTypes = unique([
      ...inferTypes(working).filter((type) => type !== "$ref"),
      ...branchRootTypes.filter((type) => type !== "$ref"),
    ]);

    const isArray = jsonTypes.includes("array") || working.items !== undefined;
    const currentArrayDepth = ancestorArrayDepth + (isArray ? 1 : 0);
    const effectivelyRequired = parentEffectivelyRequired && requiredAtParent;

    if (emitCurrent) {
      const originalFieldName = lastRuntimeSegment(runtimePath);
      const enumValues = Array.isArray(working.enum)
        ? working.enum.map(toJsonValue)
        : [];
      const nullable =
        working.nullable === true || jsonTypes.includes("null");

      addOrMerge({
        fieldId: `${toolSlug}:${direction}:${runtimePath}`,
        toolSlug,
        direction,
        jsonPath: runtimePath,
        sourceSchemaPath: sourcePath,
        originalFieldName,
        parentPath: parentRuntimePath(runtimePath),
        jsonTypes,
        requiredAtParent,
        effectivelyRequired,
        nullable,
        isArray,
        arrayDepth: currentArrayDepth,
        itemTypes: inferItemTypes(working),
        description: asString(working.description) ?? "",
        enumValues,
        hasDefault: Object.prototype.hasOwnProperty.call(working, "default"),
        ...(Object.prototype.hasOwnProperty.call(working, "default")
          ? { defaultValue: toJsonValue(working.default) }
          : {}),
        format: asString(working.format),
        constraints: getConstraints(working),
        ref: directRef,
        refResolved,
        refTrace,
        compositions: inheritedCompositions,
        rawSchemaFragment: toJsonValue(originalSchema),
        safeForInference: false,
        safetyReasons: ["CANONICAL_ENTITY_NOT_EVALUATED"],
        possibleValueSources: [],
        scopes: [],
      });
    }

    const requiredNames = new Set(asStringArray(working.required));

    if (isRecord(working.properties)) {
      for (const [name, child] of Object.entries(working.properties)) {
        if (!isRecord(child)) continue;

        const childRequired =
          requiredNames.has(name) || child.required === true;

        walk(
          child,
          appendRuntimePath(runtimePath, name),
          appendSourcePath(`${childSourceBase}.properties`, name),
          childRequired,
          emitCurrent ? effectivelyRequired : parentEffectivelyRequired,
          currentArrayDepth,
          refTrace,
          inheritedCompositions,
          true,
        );
      }
    }

    if (isRecord(working.items)) {
      walk(
        working.items,
        `${runtimePath}[]`,
        `${childSourceBase}.items`,
        requiredAtParent,
        emitCurrent ? effectivelyRequired : parentEffectivelyRequired,
        currentArrayDepth,
        refTrace,
        inheritedCompositions,
        true,
      );
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const branches = working[keyword];
      if (!Array.isArray(branches)) continue;

      branches.forEach((branch, branchIndex) => {
        if (!isRecord(branch)) return;

        const composition: CompositionEvidence = {
          kind: keyword,
          branchIndex,
          sourceSchemaPath: `${childSourceBase}.${keyword}[${branchIndex}]`,
          schemaFragment: toJsonValue(branch),
        };

        walk(
          branch,
          runtimePath,
          `${childSourceBase}.${keyword}[${branchIndex}]`,
          requiredAtParent,
          emitCurrent ? effectivelyRequired : parentEffectivelyRequired,
          ancestorArrayDepth,
          refTrace,
          [...inheritedCompositions, composition],
          false,
        );
      });
    }

    for (const keyword of ["not", "if", "then", "else", "dependentSchemas"]) {
      if (working[keyword] !== undefined) {
        unsupportedSchemaFeatures.add(keyword);
      }
    }

    if (activeRefToRelease) {
      activeRefs.delete(activeRefToRelease);
    }
  }

  walk(schema, "$", "$", true, true, 0, [], [], false);

  return {
    fields: [...fieldsByPath.values()].sort((left, right) =>
      left.jsonPath.localeCompare(right.jsonPath),
    ),
    unresolvedReferences: [...unresolvedReferences].sort(),
    unsupportedSchemaFeatures: [...unsupportedSchemaFeatures].sort(),
  };
}

function classifyGoogleService(
  tool: RawRecord,
  slug: string,
  name: string,
  description: string,
  tags: string[],
): string {
  function detectedServices(text: string): Set<string> {
    const matches = new Set<string>();

    if (
      /gmail|mailbox|\bemail\b|\bthreads?\b|\bdrafts?\b|\bmessages?\b/.test(
        text,
      )
    ) {
      matches.add("gmail");
    }

    if (/\bpeople\b|\bcontacts?\b/.test(text)) {
      matches.add("people");
    }

    if (/\bcalendar\b|\bevents?\b|\bacl\b/.test(text)) {
      matches.add("calendar");
    }

    if (
      /\bdrive\b|shared drive|\bfolders?\b|file permission/.test(
        text,
      )
    ) {
      matches.add("drive");
    }

    if (/\bspreadsheets?\b|google sheets|\bsheets?\b/.test(text)) {
      matches.add("sheets");
    }

    if (/google docs|\bdocuments?\b|\bdocs?\b/.test(text)) {
      matches.add("docs");
    }

    if (/\bslides?\b|\bpresentations?\b/.test(text)) {
      matches.add("slides");
    }

    if (/\btasks?\b|task list/.test(text)) {
      matches.add("tasks");
    }

    if (/google meet|\bmeetings?\b|\bconference\b/.test(text)) {
      matches.add("meet");
    }

    if (/\banalytics\b/.test(text)) {
      matches.add("analytics");
    }

    return matches;
  }

  function singleService(services: Set<string>): string | null {
    return services.size === 1 ? [...services][0] : null;
  }

  /*
   * Exact tool identity is strongest. This prevents a Gmail action that
   * happens to request Contacts scopes from being labeled as People.
   */
  const slugAndNameService = singleService(
    detectedServices(lowerText(slug, name)),
  );

  if (slugAndNameService) {
    return slugAndNameService;
  }

  const primaryService = singleService(
    detectedServices(lowerText(slug, name, ...tags)),
  );

  if (primaryService) {
    return primaryService;
  }

  /*
   * OAuth scopes are useful only when they identify one service
   * unambiguously. Some convenience actions request scopes from several
   * Google services.
   */
  const scopeText = asStringArray(tool.scopes)
    .join(" ")
    .toLowerCase();

  const scopeServices = new Set<string>();

  if (
    /mail\.google\.com/.test(scopeText) ||
    /\/auth\/gmail(?:\.|\b)/.test(scopeText)
  ) {
    scopeServices.add("gmail");
  }

  if (/\/auth\/contacts(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("people");
  }

  if (/\/auth\/calendar(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("calendar");
  }

  if (/\/auth\/drive(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("drive");
  }

  if (/\/auth\/spreadsheets(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("sheets");
  }

  if (/\/auth\/documents(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("docs");
  }

  if (/\/auth\/presentations(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("slides");
  }

  if (/\/auth\/tasks(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("tasks");
  }

  if (/\/auth\/meet|meetings\.space/.test(scopeText)) {
    scopeServices.add("meet");
  }

  if (/\/auth\/analytics(?:\.|\b)/.test(scopeText)) {
    scopeServices.add("analytics");
  }

  const scopeService = singleService(scopeServices);

  if (scopeService) {
    return scopeService;
  }

  /*
   * Descriptions are the weakest source because they often mention
   * alternative tools and other Google services.
   */
  const descriptionService = singleService(
    detectedServices(description.toLowerCase()),
  );

  return descriptionService ?? "unknown";
}

function classifyResourceFamily(
  toolkit: ToolkitSlug,
  service: string,
  text: string,
): string {
  if (toolkit === "googlesuper") {
    if (service === "gmail") {
      if (/thread/.test(text)) return "thread";
      if (/draft/.test(text)) return "draft";
      if (/label/.test(text)) return "label";
      if (/message|email/.test(text)) return "message";
    }

    if (service === "people") return "contact";

    if (service === "calendar") {
      if (/calendar list|list calendars|calendar identifier/.test(text)) {
        return "calendar";
      }
      if (/event/.test(text)) return "event";
      return "calendar";
    }

    if (service === "drive") {
      if (/permission/.test(text)) return "permission";
      return "file";
    }

    if (service === "sheets") {
      if (/spreadsheet/.test(text)) return "spreadsheet";
      if (/sheet/.test(text)) return "sheet";
    }

    return service === "unknown" ? "unknown" : service;
  }

  const orderedPatterns: Array<[RegExp, string]> = [
    [/release asset/, "release_asset"],
    [/workflow run/, "workflow_run"],
    [/workflow job|\bjob\b/, "job"],
    [/workflow/, "workflow"],
    [/pull request|\bpull\b/, "pull_request"],
    [/\bissue\b/, "issue"],
    [/repository content|contents? of (a |the )?repository/, "repository_content"],
    [/\brelease\b/, "release"],
    [/\bbranch\b|git ref|reference/, "branch"],
    [/\bcommit\b/, "commit"],
    [/organization|\borg\b/, "organization"],
    [/\bteam\b/, "team"],
    [/environment/, "environment"],
    [/projects? v2|projects? classic|\bproject\b/, "project"],
    [/repository|\brepo\b/, "repository"],
    [/\buser\b/, "user"],
  ];

  return orderedPatterns.find(([pattern]) => pattern.test(text))?.[1] ?? "unknown";
}

function classifyActionFamily(text: string): string {
  const actions: Array<[RegExp, string]> = [
    [/\b(list|enumerate)\b/, "list"],
    [/\b(search|find)\b/, "search"],
    [/\b(get|fetch|read|retrieve)\b/, "get"],
    [/\b(create|add|upload)\b/, "create"],
    [/\b(update|edit|patch|modify)\b/, "update"],
    [/\b(delete|remove)\b/, "delete"],
    [/\b(send|reply|forward)\b/, "send"],
    [/\b(run|trigger|dispatch|execute)\b/, "execute"],
    [/\b(cancel|stop)\b/, "cancel"],
  ];

  return actions.find(([pattern]) => pattern.test(text))?.[1] ?? "unknown";
}

function classifyProtocol(
  tool: RawRecord,
  slug: string,
  name: string,
  description: string,
  tags: string[],
): ProtocolStyle {
  const explicitMetadata = lowerText(
    asString(tool.protocol),
    asString(tool.api_protocol),
    asString(tool.apiProtocol),
    asString(tool.api_generation),
    asString(tool.apiGeneration),
    asString(tool.api_variant),
    asString(tool.apiVariant),
  );

  if (/graphql/.test(explicitMetadata)) {
    return "GRAPHQL";
  }

  if (/rest/.test(explicitMetadata)) {
    return "REST";
  }

  const primaryText = lowerText(slug, name, ...tags);

  if (
    /ai[- ]optimized|convenience|helper|primary tool|multi-step/.test(
      primaryText,
    )
  ) {
    return "COMPOSIO_CONVENIENCE_HELPER";
  }

  if (/graphql/.test(primaryText)) {
    return "GRAPHQL";
  }

  /*
   * Descriptions may establish GraphQL only when they explicitly say
   * this action uses or is implemented through GraphQL. Merely mentioning
   * GraphQL as an alternative must not change the operation protocol.
   */
  const descriptionText = description
    .trim()
    .toLowerCase();

  /*
  * These descriptions explicitly identify the tool itself as a higher-level
  * Composio helper. This is narrower than treating any mention of "primary
  * tool" or "AI-optimized" anywhere in a description as proof.
  */
  if (
    /^(?:primary tool\b|ai[- ]optimized\b)/.test(
      descriptionText,
    )
  ) {
    return "COMPOSIO_CONVENIENCE_HELPER";
  }

  if (
    /(?:this (?:action|tool|operation)|the (?:action|tool|operation))[^.]{0,100}\buses?\b[^.]{0,100}\bgraphql\b/.test(
      descriptionText,
    ) ||
    /\bimplemented (?:using|through|with) graphql\b/.test(
      descriptionText,
    ) ||
    /\buses? github(?:'s)? projects v2 graphql api\b/.test(
      descriptionText,
    )
  ) {
    return "GRAPHQL";
  }

  return "REST";
}

function classifyAbstractionLevel(
  protocol: ProtocolStyle,
  slugText: string,
): AbstractionLevel {
  if (protocol === "COMPOSIO_CONVENIENCE_HELPER") {
    return "CONVENIENCE_WORKFLOW";
  }

  if (/blob|git tree|git object|git reference|raw git|low.level/.test(slugText)) {
    return "PRIMITIVE";
  }

  return "RESOURCE_OPERATION";
}

function classifyLifecycle(
  tool: RawRecord,
  slug: string,
  name: string,
  tags: string[],
): {
  deprecated: boolean;
  legacy: boolean;
  beta: boolean;
  lifecycle: ApiLifecycle;
} {
  const primaryText = lowerText(slug, name, ...tags);

  /*
   * Do not use the full description here. Current tools frequently mention
   * deprecated or legacy alternatives in explanatory text.
   */
  const deprecated =
    tool.is_deprecated === true ||
    tool.isDeprecated === true ||
    /deprecated/.test(primaryText);

  const legacy =
    tool.is_legacy === true ||
    tool.isLegacy === true ||
    /\blegacy\b/.test(primaryText);

  const beta =
    tool.is_beta === true ||
    tool.isBeta === true ||
    /\bbeta\b|\bpreview\b/.test(primaryText);

  let lifecycle: ApiLifecycle = "CURRENT";

  if (deprecated) {
    lifecycle = "DEPRECATED";
  } else if (legacy) {
    lifecycle = "LEGACY";
  } else if (beta) {
    lifecycle = "BETA";
  }

  return {
    deprecated,
    legacy,
    beta,
    lifecycle,
  };
}

function classifySchemaCompleteness(
  schema: unknown,
  walk: SchemaWalkResult,
): SchemaCompleteness {
  if (!isRecord(schema)) return "MISSING";
  if (walk.fields.length === 0) return "GENERIC";

  const primitiveLeaves = walk.fields.filter((field) =>
    field.jsonTypes.some((type) =>
      ["string", "integer", "number", "boolean", "null"].includes(type),
    ),
  );

  const meaningfulLeaves = primitiveLeaves.filter((field) => {
    const name = normalizedName(field.originalFieldName);
    if (ENVELOPE_FIELD_NAMES.has(field.originalFieldName)) return false;
    if (INTERNAL_FIELD_PATTERN.test(field.originalFieldName)) return false;

    return (
      !GENERIC_FIELD_NAMES.has(name) ||
      field.description.trim().length > 12 ||
      field.refTrace.length > 0
    );
  });

  if (meaningfulLeaves.length === 0) return "GENERIC";

  if (
    walk.unresolvedReferences.length > 0 ||
    walk.unsupportedSchemaFeatures.length > 0
  ) {
    return "PARTIAL";
  }

  return "COMPLETE";
}

function entityResourceEvidence(
  entity: CanonicalEntityDefinition,
  field: NormalizedSchemaField,
  metadata: NormalizedToolMetadata,
): string[] {
  const evidence: string[] = [];

  const ignoredTerms = new Set([
    "github",
    "google",
    "gmail",
    "id",
    "node",
    "number",
    "name",
    "value",
  ]);

  const entityTerms = unique([
    entity.resourceFamily,
    ...entity.id.split(/[._]/).slice(1),
  ]).filter(
    (term) =>
      term.length > 2 &&
      !ignoredTerms.has(term.toLowerCase()),
  );

  const parentSegment =
    field.parentPath
      ?.split(".")
      .at(-1)
      ?.replace(/\[\]/g, "") ?? "";

  const lastReference =
    field.refTrace.at(-1) ??
    field.ref ??
    "";

  const definitionMatch = field.sourceSchemaPath.match(
    /\.(?:\$defs|definitions)\.([^.]+)/,
  );

  const definitionName = definitionMatch?.[1] ?? "";

  /*
   * Use only the immediate containing resource. The complete path may
   * contain an outer workflow, issue, or repository even when the field
   * actually belongs to an Actor, Milestone, User, or another nested object.
   */
  const localStructureText = lowerText(
    parentSegment,
    lastReference,
    definitionName,
  );

  const descriptionText = field.description.toLowerCase();

  function containsResourceTerm(
    text: string,
    term: string,
  ): boolean {
    const normalizedText = text
      .replace(/[_-]/g, " ")
      .replace(/\s+/g, " ");

    const normalizedTerm = term
      .replace(/[_-]/g, " ")
      .replace(/\s+/g, " ");

    return (
      normalizedText.includes(normalizedTerm) ||
      normalizedText.includes(`${normalizedTerm}s`)
    );
  }

  if (metadata.resourceFamily === entity.resourceFamily) {
    evidence.push(
      `tool resource family is ${entity.resourceFamily}`,
    );
  }

  if (
    entityTerms.some((term) =>
      containsResourceTerm(localStructureText, term)
    )
  ) {
    evidence.push("resource-specific field path or reference");
  }

  if (
    entityTerms.some((term) =>
      containsResourceTerm(descriptionText, term)
    )
  ) {
    evidence.push("resource-specific field description");
  }

  return unique(evidence);
}

function localIdentityResourceFamily(
  field: NormalizedSchemaField,
): string | null {
  const parentSegment =
    field.parentPath
      ?.split(".")
      .at(-1)
      ?.replace(/\[\]/g, "") ?? "";

  const finalReference =
    field.refTrace.at(-1) ??
    field.ref ??
    "";

  const definitionMatches = [
    ...field.sourceSchemaPath.matchAll(
      /\.(?:\$defs|definitions)\.([^.]+)/g,
    ),
  ];

  const definitionName =
    definitionMatches.at(-1)?.[1] ?? "";

  const localText = normalizedName(
    lowerText(
      parentSegment,
      finalReference,
      definitionName,
    ),
  );
  /*
  * Nested identities must be classified from the immediate object, not
  * inherited from an outer event, repository, release, or environment.
  */
  if (
    /actor|author|uploader|creator|organizer|attendee|simpleuser|githubuser|owner/.test(
      localText,
    )
  ) {
    return "user";
  }

  if (/license/.test(localText)) {
    return "license";
  }

  if (/variables?/.test(localText)) {
    return "variable";
  }

  if (/revisions?/.test(localText)) {
    return "revision";
  }

  if (
    /actor|author|uploader|simpleuser|githubuser/.test(
      localText,
    )
  ) {
    return "user";
  }

  if (
    /releaseasset|assets/.test(localText)
  ) {
    return "release_asset";
  }

  /*
  * A step is more specific than its containing workflow job.
  */
  if (/steps?/.test(localText)) {
    return "step";
  }

  if (
    /workflowjob|jobs/.test(localText)
  ) {
    return "job";
  }

  if (/milestone/.test(localText)) {
    return "milestone";
  }

  if (/workflowrun/.test(localText)) {
    return "workflow_run";
  }

  if (/pullrequest/.test(localText)) {
    return "pull_request";
  }

  if (/repositorycontent/.test(localText)) {
    return "repository_content";
  }

  if (/repository/.test(localText)) {
    return "repository";
  }

  if (/workflow/.test(localText)) {
    return "workflow";
  }

  if (/release/.test(localText)) {
    return "release";
  }

  if (/branches?|gitref/.test(localText)) {
    return "branch";
  }

  if (/commits?/.test(localText)) {
    return "commit";
  }

  if (/issues?/.test(localText)) {
    return "issue";
  }

  if (/teams?/.test(localText)) {
    return "team";
  }

  if (/organizations?|orgs?/.test(localText)) {
    return "organization";
  }

  if (/environments?/.test(localText)) {
    return "environment";
  }

  if (/threads?/.test(localText)) {
    return "thread";
  }

  if (/messages?/.test(localText)) {
    return "message";
  }

  if (/drafts?/.test(localText)) {
    return "draft";
  }

  if (/labels?/.test(localText)) {
    return "label";
  }

  /*
  * CalendarEvent-style schema names contain both words.
  * Check the contained event resource before its calendar container.
  */
  if (/events?/.test(localText)) {
    return "event";
  }

  if (/calendars?/.test(localText)) {
    return "calendar";
  }

  if (/spreadsheets?/.test(localText)) {
    return "spreadsheet";
  }

  if (/sheets?/.test(localText)) {
    return "sheet";
  }

  if (/files?|folders?/.test(localText)) {
    return "file";
  }

  if (/contacts?|people/.test(localText)) {
    return "contact";
  }

  return null;
}

function assignCanonicalEntity(
  field: NormalizedSchemaField,
  metadata: NormalizedToolMetadata,
  ontology: OntologyDocument,
): void {
  const fieldName = normalizedName(field.originalFieldName);
  const description = field.description.toLowerCase();

  const localResourceFamily =
    localIdentityResourceFamily(field);

  const candidates: Array<{
    definition: CanonicalEntityDefinition;
    score: number;
    evidence: string[];
    reasonCodes: string[];
  }> = [];

  for (const definition of ontology.entities) {
    if (definition.service !== metadata.underlyingService) continue;
    if (!definition.allowedProtocols.includes(metadata.protocol)) continue;


    /*
    * Repository invitation IDs are not repository IDs.
    * The response may separately contain the actual
    * repository under $.data.repository.
    */
    if (
      (
        definition.id === "github.repository_id" ||
        definition.id === "github.repository_node_id"
      ) &&
      /\binvitation\b/.test(description)
    ) {
      continue;
    }
    /*
    * Google watch endpoints return notification-channel
    * IDs. A channel ID is not the ID of the watched
    * calendar, event, file, message, or other resource.
    */
    if (
      fieldName === "id" &&
      /\bchannel\b/i.test(description) &&
      /\b(?:identifies|identifier|channel id)\b/i.test(
        description,
      )
    ) {
      continue;
    }

    /*
    * These fields encode different identity systems or compound values.
    * They must not inherit an entity from a similar description.
    */
    if (
      fieldName === "icaluid" &&
      definition.id === "google.event_id"
    ) {
      continue;
    }

    if (
      fieldName === "nodeid" &&
      definition.identityKind !== "GRAPHQL_NODE_ID"
    ) {
      continue;
    }

    if (
      fieldName === "fullname" &&
      (
        definition.id === "github.owner" ||
        definition.id === "github.repository_name"
      )
    ) {
      continue;
    }

    /*
    * A tag-protection rule ID is not the ID of the
    * repository containing the rule.
    */
    if (
      (
        definition.id === "github.repository_id" ||
        definition.id === "github.repository_node_id"
      ) &&
      /tag protection rule/.test(description)
    ) {
      continue;
    }
    /*
    * A Drive revision ID is not the file ID of the containing file.
    */
    if (
      definition.id === "google.drive_file_id" &&
      /revision/.test(fieldName)
    ) {
      continue;
    }

    /*
    * Tree, blob, and content object identities are not commit SHAs.
    */
    if (
      definition.id === "github.commit_sha" &&
      (
        /tree|blob|content/.test(fieldName) ||
        /\b(?:tree|blob|content)\b/.test(description)
      )
    ) {
      continue;
    }

    /*
    * Only a generic field named "number" is ambiguous when its description
    * says the result may be either an issue or a pull request.
    *
    * Explicit fields such as issue_number and pull_number retain their
    * declared resource identity even when their descriptions mention both
    * GitHub resource types.
    */
    if (
      fieldName === "number" &&
      (
        definition.id === "github.issue_number" ||
        definition.id === "github.pull_request_number"
      ) &&
      /issue\s+(?:or|and)\s+pull request|pull request\s+(?:or|and)\s+issue/.test(
        description,
      )
    ) {
      continue;
    }

    const compatibleType = field.jsonTypes.some((type) =>
      definition.jsonTypes.includes(type),
    );
    if (!compatibleType) continue;

    const exactAliases = definition.aliases.exactFieldNames.map(normalizedName);
    const contextualAliases = definition.aliases.contextualFieldNames.map(normalizedName);
    const exactMatch = exactAliases.includes(fieldName);
    const contextualMatch = contextualAliases.includes(fieldName);
    const descriptionMatches =
      definition.aliases.descriptionPatterns.filter(
        (pattern) =>
          description.includes(pattern.toLowerCase()),
      );

    const resourceEvidence = entityResourceEvidence(
      definition,
      field,
      metadata,
    );

    /*
    * Search expressions may mention emails, IDs, names, refs, or other
    * identifiers without themselves being those identifiers.
    */
    const searchCriterion =
      field.direction === "input" &&
      new Set([
        "query",
        "q",
        "search",
        "searchquery",
        "filter",
        "filterquery",
      ]).has(fieldName);

    if (
      searchCriterion &&
      !exactMatch &&
      !contextualMatch
    ) {
      continue;
    }

    if (
      !exactMatch &&
      !contextualMatch &&
      descriptionMatches.length === 0
    ) {
      continue;
    }

    /*
    * Generic id, number, and node_id fields must agree with their immediate
    * containing resource. The outer tool may represent a workflow run while
    * the current field belongs to a job, step, user, or release asset.
    */
    const locallyScopedAmbiguousIdentity =
      new Set([
        "id",
        "number",
        "name",
        "nodeid",
      ]).has(fieldName);

    if (
      locallyScopedAmbiguousIdentity &&
      !exactMatch &&
      localResourceFamily &&
      definition.resourceFamily !== localResourceFamily
    ) {
      continue;
    }

    const ambiguousAlias = new Set([
      "id",
      "number",
      "name",
      "login",
      "value",
      "sha",
      "ref",
      "runid",
      "nodeid",
      "fullname",
      "icaluid",
    ]).has(fieldName);

    const localResourceEvidence = resourceEvidence.filter((item) =>
      item === "resource-specific field path or reference" ||
      item === "resource-specific field description",
    );

    if (
      definition.requiresResourceContext &&
      ((!exactMatch && resourceEvidence.length === 0) ||
        (ambiguousAlias && localResourceEvidence.length === 0))
    ) {
      continue;
    }

    let score = 2;
    const evidence = ["compatible JSON type", "compatible service"];
    const reasonCodes = ["TYPE_COMPATIBLE", "SERVICE_COMPATIBLE"];

    if (exactMatch) {
      score += 5;
      evidence.push(`exact field alias: ${field.originalFieldName}`);
      reasonCodes.push("ENTITY_EXACT_FIELD_ALIAS");
    }

    if (contextualMatch) {
      score += 2;
      evidence.push(`contextual field alias: ${field.originalFieldName}`);
      reasonCodes.push("ENTITY_CONTEXTUAL_FIELD_ALIAS");
    }

    if (descriptionMatches.length > 0) {
      score += 3;
      evidence.push(`description pattern: ${descriptionMatches[0]}`);
      reasonCodes.push("ENTITY_DESCRIPTION_MATCH");
    }

    if (metadata.resourceFamily === definition.resourceFamily) {
      score += 2;
      reasonCodes.push("RESOURCE_FAMILY_MATCH");
    }

    if (
      locallyScopedAmbiguousIdentity &&
      localResourceFamily === definition.resourceFamily
    ) {
      score += 4;

      evidence.push(
        `immediate containing resource is ${localResourceFamily}`,
      );

      reasonCodes.push(
        "LOCAL_RESOURCE_FAMILY_MATCH",
      );
    }

    if (resourceEvidence.length > 0) {
      score += Math.min(3, resourceEvidence.length);
      evidence.push(...resourceEvidence);
      reasonCodes.push("RESOURCE_CONTEXT_MATCH");
    }

    candidates.push({
      definition,
      score,
      evidence: unique(evidence),
      reasonCodes: unique(reasonCodes),
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1];

  if (!best || best.score < 7 || (second && second.score === best.score)) {
    return;
  }

  const confidence = best.score >= 10 ? "HIGH" : best.score >= 8 ? "MEDIUM" : "LOW";

  field.canonicalEntity = {
    entity: best.definition.id,
    confidence,
    evidence: best.evidence,
    reasonCodes: best.reasonCodes,
  };
}

function scopeSourcePath(
  kind: ScopeKind,
  inputFields: NormalizedSchemaField[],
): string | undefined {
  const canonicalByScope: Partial<Record<ScopeKind, string[]>> = {
    account: ["gmail.user_id"],
    owner: ["github.owner"],
    repository: ["github.repository_name", "github.repository_id"],
    workflow: ["github.workflow_id"],
    calendar: ["google.calendar_id"],
    spreadsheet: ["google.spreadsheet_id"],
    environment: ["github.environment_name"],
    organization: ["github.organization"],
    team: ["github.team_slug"],
  };

  const canonical = canonicalByScope[kind] ?? [];
  const byCanonical = inputFields.find((field) =>
    canonical.includes(field.canonicalEntity?.entity ?? ""),
  );
  if (byCanonical) return byCanonical.jsonPath;

  const namesByScope: Partial<Record<ScopeKind, string[]>> = {
    account: ["user_id", "account_id"],
    owner: ["owner", "repository_owner", "repo_owner"],
    repository: ["repo", "repository", "repository_name", "repo_name"],
    workflow: ["workflow_id"],
    calendar: ["calendar_id", "calendarid"],
    spreadsheet: ["spreadsheet_id", "spreadsheetid"],
    shared_drive: ["drive_id", "shared_drive_id"],
    environment: ["environment_name"],
    organization: ["organization", "org"],
    team: ["team_slug"],
  };

  const acceptedNames = (namesByScope[kind] ?? []).map(normalizedName);
  return inputFields.find((field) =>
    acceptedNames.includes(normalizedName(field.originalFieldName)),
  )?.jsonPath;
}

function applyFieldSemantics(
  tool: NormalizedTool,
  ontology: OntologyDocument,
): void {
  const allFields = [...tool.inputFields, ...tool.outputFields];

  for (const field of allFields) {
    assignCanonicalEntity(field, tool.metadata, ontology);
  }

  const definitions = new Map(
    ontology.entities.map((definition) => [definition.id, definition]),
  );

  for (const field of allFields) {
    if (field.direction === "input") {
      field.possibleValueSources = [
        {
          source: "USER",
          reason: "The caller may provide the input explicitly.",
          preferred: true,
        },
        {
          source: "PRIOR_CONTEXT",
          reason: "The value may already exist in trusted workflow context.",
          preferred: false,
        },
      ];

      if (field.canonicalEntity) {
        field.possibleValueSources.push({
          source: "TOOL_OUTPUT",
          reason: "A prior tool may produce the same canonical entity.",
          preferred: false,
        });
      }
    } else {
      field.possibleValueSources = [
        {
          source: "TOOL_OUTPUT",
          reason: "The value is declared in this tool's output schema.",
          preferred: true,
        },
      ];
    }

    const definition = field.canonicalEntity
      ? definitions.get(field.canonicalEntity.entity)
      : undefined;

    field.scopes = (definition?.scopeKinds ?? []).map((kind) => {
      const valueSourcePath = scopeSourcePath(kind, tool.inputFields);
      const evidence = [`Ontology requires ${kind} scope.`];
      if (valueSourcePath) evidence.push(`Scope supplied by ${valueSourcePath}.`);

      const scope: ResourceScope = {
        kind,
        requiredForIdentity: !["account", "global", "unknown"].includes(kind),
        evidence,
      };

      if (valueSourcePath) scope.valueSourcePath = valueSourcePath;
      return scope;
    });

    const safetyReasons: string[] = [];
    const schemaCompleteness =
      field.direction === "input"
        ? tool.metadata.inputSchemaCompleteness
        : tool.metadata.outputSchemaCompleteness;

    if (!field.canonicalEntity) {
      safetyReasons.push("NO_CANONICAL_ENTITY");
    } else if (field.canonicalEntity.confidence !== "HIGH") {
      safetyReasons.push("CANONICAL_ENTITY_NOT_HIGH_CONFIDENCE");
    }

    if (schemaCompleteness === "GENERIC") safetyReasons.push("SCHEMA_GENERIC");
    if (schemaCompleteness === "MISSING") safetyReasons.push("SCHEMA_MISSING");
    if (field.ref && !field.refResolved) safetyReasons.push("UNRESOLVED_REFERENCE");
    if (INTERNAL_FIELD_PATTERN.test(field.originalFieldName)) {
      safetyReasons.push("INTERNAL_COMPOSIO_FIELD");
    }
    if (field.jsonTypes.some((type) => ["object", "array", "unknown"].includes(type))) {
      safetyReasons.push("NON_SCALAR_FIELD");
    }

    field.safeForInference = safetyReasons.length === 0;
    field.safetyReasons =
      safetyReasons.length > 0
        ? safetyReasons
        : ["HIGH_CONFIDENCE_CANONICAL_ENTITY"];
  }

  tool.metadata.resourceScopes = uniqueScopeObjects(
    allFields.flatMap((field) => field.scopes),
  );
}

function uniqueScopeObjects(scopes: ResourceScope[]): ResourceScope[] {
  const seen = new Set<string>();
  const result: ResourceScope[] = [];

  for (const scope of scopes) {
    const key = `${scope.kind}:${scope.valueSourcePath ?? ""}:${scope.value ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(scope);
  }

  return result;
}

function toolVersion(tool: RawRecord): string | null {
  return asString(tool.version) ?? asString(tool.toolkit_version);
}

function normalizeTool(
  location: RawToolLocation,
  ontology: OntologyDocument,
): NormalizedTool {
  const { tool, toolkit, rawFile, snapshotFormat, pageIndex, itemIndex } = location;
  const slug = asString(tool.slug) ?? `UNKNOWN_${pageIndex}_${itemIndex}`;
  const name = asString(tool.name) ?? slug;
  const description = asString(tool.description) ?? "";
  const tags = asStringArray(tool.tags);
  const primaryClassificationText = lowerText(
    slug,
    name,
    ...tags,
  );

  const classificationText = lowerText(
    primaryClassificationText,
    description,
  );

  const service =
  toolkit === "github"
    ? "github"
    : classifyGoogleService(
        tool,
        slug,
        name,
        description,
        tags,
      );

    let resourceFamily = classifyResourceFamily(
      toolkit,
      service,
      primaryClassificationText,
    );

    if (resourceFamily === "unknown") {
      resourceFamily = classifyResourceFamily(
        toolkit,
        service,
        classificationText,
      );
    }

    const protocol = classifyProtocol(
      tool,
      slug,
      name,
      description,
      tags,
    );

    const lifecycle = classifyLifecycle(
      tool,
      slug,
      name,
      tags,
    );

  const input = schemaLocation(tool, "input_parameters", "inputParameters");
  const output = schemaLocation(tool, "output_parameters", "outputParameters");
  const inputWalk = normalizeSchemaFields(slug, "input", input.schema);
  const outputWalk = normalizeSchemaFields(slug, "output", output.schema);

  const metadata: NormalizedToolMetadata = {
    slug,
    name,
    description,
    toolkit,
    toolkitVersion: toolVersion(tool),
    availableToolkitVersions: asStringArray(
      tool.available_versions ?? tool.availableVersions,
    ),
    underlyingService: service,
    resourceFamily,
    actionFamily: classifyActionFamily(primaryClassificationText),
    deprecated: lifecycle.deprecated,
    legacy: lifecycle.legacy,
    beta: lifecycle.beta,
    lifecycle: lifecycle.lifecycle,
    apiGeneration:
      asString(tool.api_generation) ??
      asString(tool.apiGeneration) ??
      "unknown",
    apiVariant:
      asString(tool.api_variant) ?? asString(tool.apiVariant) ?? "default",
    protocol,
    abstractionLevel: classifyAbstractionLevel(protocol, classificationText),
    inputSchemaCompleteness: classifySchemaCompleteness(
      input.schema,
      inputWalk,
    ),
    outputSchemaCompleteness: classifySchemaCompleteness(
      output.schema,
      outputWalk,
    ),
    oauthScopes: asStringArray(tool.scopes),
    resourceScopes: [],
    tags,
    rawSource: {
      rawFile,
      snapshotFormat,
      pageIndex,
      itemIndex,
      toolSlug: slug,
    },
  };

  const warnings: string[] = [];
  if (metadata.underlyingService === "unknown") warnings.push("UNKNOWN_SERVICE");
  if (metadata.resourceFamily === "unknown") warnings.push("UNKNOWN_RESOURCE_FAMILY");
  if (input.location === null) warnings.push("INPUT_SCHEMA_LOCATION_MISSING");
  if (output.location === null) warnings.push("OUTPUT_SCHEMA_LOCATION_MISSING");
  if (metadata.toolkitVersion === null) warnings.push("TOOLKIT_VERSION_MISSING");

  const normalized: NormalizedTool = {
    metadata,
    inputFields: inputWalk.fields,
    outputFields: outputWalk.fields,
    unresolvedReferences: unique([
      ...inputWalk.unresolvedReferences,
      ...outputWalk.unresolvedReferences,
    ]),
    unsupportedSchemaFeatures: unique([
      ...inputWalk.unsupportedSchemaFeatures,
      ...outputWalk.unsupportedSchemaFeatures,
    ]),
    warnings,
  };

  applyFieldSemantics(normalized, ontology);
  return normalized;
}

async function readRawSource(
  toolkit: ToolkitSlug,
  filePath: string,
): Promise<SourceFileResult> {
  const snapshot: unknown = await Bun.file(filePath).json();

  if (!isRecord(snapshot)) {
    throw new Error(`Expected an object in ${filePath}`);
  }

  const pagesValue =
    snapshot.tool_list_responses ?? snapshot.toolListResponses;

  if (!Array.isArray(pagesValue)) {
    throw new Error(
      `Expected tool_list_responses array in ${filePath}`,
    );
  }

  const tools: RawToolLocation[] = [];

  pagesValue.forEach((page, pageIndex) => {
    if (!isRecord(page) || !Array.isArray(page.items)) return;

    page.items.forEach((tool, itemIndex) => {
      if (!isRecord(tool)) return;

      tools.push({
        toolkit,
        rawFile: filePath,
        snapshotFormat:
          asString(snapshot.format) ?? "authenticated-raw-tool-snapshot",
        pageIndex,
        itemIndex,
        tool,
      });
    });
  });

  const toolkitVersion =
    tools.map((item) => toolVersion(item.tool)).find(Boolean) ??
    asString(snapshot.toolkit_version) ??
    asString(snapshot.toolkitVersion) ??
    asString(snapshot.version);

  return {
    toolkit,
    path: filePath,
    toolkitVersion,
    tools,
  };
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function summarizeCatalog(tools: NormalizedTool[]): NormalizedToolCatalog["summary"] {
  const toolsByToolkit: Record<string, number> = {};
  const toolsByService: Record<string, number> = {};
  const toolsByResourceFamily: Record<string, number> = {};
  const schemaCompleteness: Record<SchemaCompleteness, number> = {
    COMPLETE: 0,
    PARTIAL: 0,
    GENERIC: 0,
    MISSING: 0,
  };
  const abstractionLevels: Record<AbstractionLevel, number> = {
    PRIMITIVE: 0,
    RESOURCE_OPERATION: 0,
    CONVENIENCE_WORKFLOW: 0,
    UNKNOWN: 0,
  };

  let inputFieldCount = 0;
  let outputFieldCount = 0;
  let canonicalEntityAssignments = 0;
  let deliberatelyUnclassifiedFields = 0;
  let warningCount = 0;

  for (const tool of tools) {
    increment(toolsByToolkit, tool.metadata.toolkit);
    increment(toolsByService, tool.metadata.underlyingService);
    increment(toolsByResourceFamily, tool.metadata.resourceFamily);
    schemaCompleteness[tool.metadata.inputSchemaCompleteness] += 1;
    schemaCompleteness[tool.metadata.outputSchemaCompleteness] += 1;
    abstractionLevels[tool.metadata.abstractionLevel] += 1;

    inputFieldCount += tool.inputFields.length;
    outputFieldCount += tool.outputFields.length;
    warningCount +=
      tool.warnings.length +
      tool.unresolvedReferences.length +
      tool.unsupportedSchemaFeatures.length;

    for (const field of [...tool.inputFields, ...tool.outputFields]) {
      if (field.canonicalEntity) canonicalEntityAssignments += 1;
      else if (
        field.jsonTypes.some((type) =>
          ["string", "integer", "number", "boolean"].includes(type),
        )
      ) {
        deliberatelyUnclassifiedFields += 1;
      }
    }
  }

  return {
    toolCount: tools.length,
    inputFieldCount,
    outputFieldCount,
    toolsByToolkit,
    toolsByService,
    toolsByResourceFamily,
    schemaCompleteness,
    abstractionLevels,
    deprecatedToolCount: tools.filter((tool) => tool.metadata.deprecated).length,
    legacyToolCount: tools.filter((tool) => tool.metadata.legacy).length,
    betaToolCount: tools.filter((tool) => tool.metadata.beta).length,
    canonicalEntityAssignments,
    deliberatelyUnclassifiedFields,
    warningCount,
  };
}

export async function buildNormalizedCatalog(): Promise<NormalizedToolCatalog> {
  const ontology = (await Bun.file(ONTOLOGY_PATH).json()) as OntologyDocument;

  if (ontology.format !== "dependency-ontology-v1") {
    throw new Error(`Unexpected ontology format in ${ONTOLOGY_PATH}`);
  }

  const sourceFiles = await Promise.all(
    RAW_SOURCES.map((source) => readRawSource(source.toolkit, source.path)),
  );

  const tools = sourceFiles
    .flatMap((source) => source.tools)
    .map((location) => normalizeTool(location, ontology))
    .sort((left, right) =>
      left.metadata.slug.localeCompare(right.metadata.slug),
    );

  return {
    format: "normalized-tool-catalog-v1",
    generatedAt: new Date().toISOString(),
    sourceFiles: sourceFiles.map((source) => ({
      toolkit: source.toolkit,
      path: source.path,
      toolkitVersion: source.toolkitVersion,
      toolCount: source.tools.length,
    })),
    tools,
    summary: summarizeCatalog(tools),
  };
}

function sortedRecordEntries(record: Record<string, number>): string {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join("\n");
}

function renderNormalizationReport(catalog: NormalizedToolCatalog): string {
  const representativeSlugs = [
    "GOOGLESUPER_LIST_THREADS",
    "GOOGLESUPER_SEARCH_PEOPLE",
    "GOOGLESUPER_EVENTS_LIST",
    "GITHUB_FIND_REPOSITORIES",
    "GITHUB_LIST_REPOSITORY_WORKFLOWS",
    "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
  ];

  const representatives = representativeSlugs
    .map((slug) => catalog.tools.find((tool) => tool.metadata.slug === slug))
    .filter((tool): tool is NormalizedTool => tool !== undefined)
    .map(
      (tool) =>
        `| ${tool.metadata.slug} | ${tool.metadata.underlyingService} | ${tool.metadata.resourceFamily} | ${tool.metadata.inputSchemaCompleteness} | ${tool.metadata.outputSchemaCompleteness} | ${tool.metadata.deprecated} |`,
    )
    .join("\n");

  const unresolvedTools = catalog.tools
    .filter((tool) => tool.unresolvedReferences.length > 0)
    .slice(0, 20)
    .map(
      (tool) =>
        `- ${tool.metadata.slug}: ${tool.unresolvedReferences.join(", ")}`,
    )
    .join("\n");

  return `# Normalization Report

Generated by \`bun run normalize\` from authenticated raw tool snapshots.

## Source snapshots

| Toolkit | Version | Tools | Raw file |
|---|---:|---:|---|
${catalog.sourceFiles
  .map(
    (source) =>
      `| ${source.toolkit} | ${source.toolkitVersion ?? "unknown"} | ${source.toolCount} | \`${source.path}\` |`,
  )
  .join("\n")}

## Totals

- Normalized tools: ${catalog.summary.toolCount}
- Input fields: ${catalog.summary.inputFieldCount}
- Output fields: ${catalog.summary.outputFieldCount}
- Canonical entity assignments: ${catalog.summary.canonicalEntityAssignments}
- Deliberately unclassified scalar fields: ${catalog.summary.deliberatelyUnclassifiedFields}
- Deprecated tools: ${catalog.summary.deprecatedToolCount}
- Legacy tools: ${catalog.summary.legacyToolCount}
- Beta or preview tools: ${catalog.summary.betaToolCount}
- Warnings and unresolved features: ${catalog.summary.warningCount}

## Tools by toolkit

| Toolkit | Count |
|---|---:|
${sortedRecordEntries(catalog.summary.toolsByToolkit)}

## Tools by underlying service

| Service | Count |
|---|---:|
${sortedRecordEntries(catalog.summary.toolsByService)}

## Tools by resource family

| Resource family | Count |
|---|---:|
${sortedRecordEntries(catalog.summary.toolsByResourceFamily)}

## Schema completeness

Counts include both input and output schemas.

| Classification | Count |
|---|---:|
${sortedRecordEntries(catalog.summary.schemaCompleteness)}

## Abstraction levels

| Level | Count |
|---|---:|
${sortedRecordEntries(catalog.summary.abstractionLevels)}

## Representative normalized tools

| Tool | Service | Resource family | Input | Output | Deprecated |
|---|---|---|---|---|---|
${representatives}

## Conservative inference policy

- Generic identifiers are preserved but not assigned automatically without resource evidence.
- REST IDs, GraphQL node IDs, numbers, names, refs, and SHAs remain distinct.
- Google Super tools are separated by underlying Google service.
- Collection-derived fields retain array paths such as \`[]\`.
- Generic and missing output schemas cannot support automatic dependency acceptance.
- Deprecated status is preserved independently of schema completeness.
- Local references are resolved cycle-safely and their traces are retained.
- Composition branches are preserved instead of silently flattened.

## Unresolved local references

${unresolvedTools || "No unresolved local references were recorded."}

## Phase boundary

This report covers schema normalization only. It does not claim that dependency candidates, graph edges, LLM adjudication, workflow planning, or visualization have been implemented.
`;
}

export async function writeNormalizedCatalog(): Promise<NormalizedToolCatalog> {
  const catalog = await buildNormalizedCatalog();

  await ensureDirectory(path.dirname(OUTPUT_PATH));
  await ensureDirectory(path.dirname(REPORT_PATH));

  await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await writeFile(REPORT_PATH, renderNormalizationReport(catalog), "utf8");

  return catalog;
}

if (import.meta.main) {
  writeNormalizedCatalog()
    .then((catalog) => {
      console.log("Normalization complete:");
      console.log(JSON.stringify(catalog.summary, null, 2));
      console.log(`Wrote ${OUTPUT_PATH}`);
      console.log(`Wrote ${REPORT_PATH}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
