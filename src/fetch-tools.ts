import { Composio } from "@composio/core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const TOOLKITS = ["googlesuper", "github"] as const;
const PAGE_LIMIT = 1000;
const TOOLKIT_VERSION_SELECTOR = "latest";
const MAX_SCHEMA_DEPTH = 40;
const RAW_DIR = path.join(process.cwd(), "data", "raw");
const OBSERVATIONS_PATH = path.join(process.cwd(), "docs", "schema-observations.md");
const STATUS_PATH = path.join(process.cwd(), "IMPLEMENTATION_STATUS.md");

type ToolkitSlug = (typeof TOOLKITS)[number];
type JsonRecord = Record<string, unknown>;
type OutputClassification = "COMPLETE" | "PARTIAL" | "GENERIC" | "MISSING";
type SchemaFormat =
  | "STANDARD_JSON_SCHEMA"
  | "FLAT_PARAMETER_MAP"
  | "SCALAR_OR_ARRAY"
  | "EMPTY"
  | "UNKNOWN";

type RawTool = JsonRecord & {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  input_parameters?: unknown;
  output_parameters?: unknown;
  inputParameters?: unknown;
  outputParameters?: unknown;
  version?: unknown;
  available_versions?: unknown;
  availableVersions?: unknown;
  deprecated?: unknown;
  is_deprecated?: unknown;
  isDeprecated?: unknown;
  scopes?: unknown;
  tags?: unknown;
  toolkit?: unknown;
};

type ToolListPage = JsonRecord & {
  items: RawTool[];
  next_cursor?: string | null;
  total_pages?: number;
  current_page?: number;
  total_items?: number;
};

type ToolkitSnapshot = {
  snapshot_format: "composio-raw-tool-responses-v1";
  retrieval: {
    endpoint: string;
    toolkit_slug: ToolkitSlug;
    toolkit_versions: string;
    include_deprecated: true;
    page_limit: number;
    fetched_at: string;
  };
  toolkit_metadata_response: JsonRecord;
  tool_list_responses: ToolListPage[];
};

type FieldSummary = {
  path: string;
  name: string;
  type: string;
  description: string;
  required: boolean;
  nested: boolean;
};

type ToolInspection = {
  slug: string;
  name: string;
  description: string;
  inputFormat: SchemaFormat;
  outputFormat: SchemaFormat;
  requiredInputs: FieldSummary[];
  optionalInputs: FieldSummary[];
  nestedInputs: FieldSummary[];
  outputFields: FieldSummary[];
  outputClassification: OutputClassification;
  outputClassificationReasons: string[];
  version: string | null;
  availableVersions: string[];
  deprecated: boolean;
  scopes: string[];
  tags: string[];
  unsafeReasons: string[];
};

type ToolkitResult = {
  toolkit: ToolkitSlug;
  snapshot: ToolkitSnapshot;
  tools: RawTool[];
  outputCounts: Record<OutputClassification, number>;
  inputFormatCounts: Record<SchemaFormat, number>;
  outputFormatCounts: Record<SchemaFormat, number>;
  inspections: ToolInspection[];
  representative: Map<string, ToolInspection[]>;
  rawPath: string;
  rawSizeBytes: number;
  paginationRequired: boolean;
  sdkCount: number;
  sdkCrossCheck: "MATCH" | "SDK_TRUNCATED" | "MISMATCH";
  versions: string[];
  availableVersions: string[];
  metadataVersion: string | null;
  metadataAvailableVersions: string[];
  duplicateSlugs: string[];
  toolsWithoutSlugs: number;
};

const GENERIC_FIELD_NAMES = new Set([
  "data",
  "result",
  "results",
  "response",
  "responses",
  "message",
  "messages",
  "success",
  "successful",
  "error",
  "errors",
  "status",
  "id",
  "ids",
  "number",
  "numbers",
  "value",
  "values",
  "object",
  "objects",
  "item",
  "items",
]);

const AMBIGUOUS_INPUT_NAMES = new Set([
  "id",
  "ids",
  "number",
  "numbers",
  "name",
  "key",
  "value",
  "path",
  "ref",
  "reference",
  "token",
]);

const JSON_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "type",
  "title",
  "description",
  "properties",
  "required",
  "items",
  "additionalProperties",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "enum",
  "const",
  "default",
  "examples",
  "format",
  "nullable",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

const REPRESENTATIVE_GROUPS: Array<{
  toolkit: ToolkitSlug;
  label: string;
  preferredSlugs: string[];
}> = [
  {
    toolkit: "googlesuper",
    label: "Gmail messages",
    preferredSlugs: [
      "GOOGLESUPER_LIST_MESSAGES",
      "GOOGLESUPER_FETCH_MESSAGE_BY_MESSAGE_ID",
      "GOOGLESUPER_SEND_EMAIL",
    ],
  },
  {
    toolkit: "googlesuper",
    label: "Gmail threads",
    preferredSlugs: [
      "GOOGLESUPER_LIST_THREADS",
      "GOOGLESUPER_FETCH_MESSAGE_BY_THREAD_ID",
      "GOOGLESUPER_REPLY_TO_THREAD",
    ],
  },
  {
    toolkit: "googlesuper",
    label: "Google Contacts or People",
    preferredSlugs: [
      "GOOGLESUPER_GET_CONTACTS",
      "GOOGLESUPER_GET_PEOPLE",
      "GOOGLESUPER_SEARCH_PEOPLE",
    ],
  },
  {
    toolkit: "googlesuper",
    label: "Google Calendar",
    preferredSlugs: [
      "GOOGLESUPER_EVENTS_LIST",
      "GOOGLESUPER_EVENTS_GET",
      "GOOGLESUPER_CREATE_EVENT",
    ],
  },
  {
    toolkit: "googlesuper",
    label: "Google Drive",
    preferredSlugs: [
      "GOOGLESUPER_LIST_FILES",
      "GOOGLESUPER_GET_FILE_METADATA",
      "GOOGLESUPER_FIND_FILE",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub repositories",
    preferredSlugs: [
      "GITHUB_FIND_REPOSITORIES",
      "GITHUB_CREATE_REPOSITORY",
      "GITHUB_CREATE_AN_ORGANIZATION_REPOSITORY",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub issues",
    preferredSlugs: [
      "GITHUB_GET_AN_ISSUE",
      "GITHUB_CREATE_AN_ISSUE",
      "GITHUB_LIST_REPOSITORY_ISSUES",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub pull requests",
    preferredSlugs: [
      "GITHUB_FIND_PULL_REQUESTS",
      "GITHUB_GET_A_PULL_REQUEST",
      "GITHUB_CREATE_A_PULL_REQUEST",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub Actions workflows",
    preferredSlugs: [
      "GITHUB_GET_A_WORKFLOW",
      "GITHUB_LIST_REPOSITORY_WORKFLOWS",
      "GITHUB_CREATE_A_WORKFLOW_DISPATCH_EVENT",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub Actions workflow runs",
    preferredSlugs: [
      "GITHUB_GET_A_WORKFLOW_RUN",
      "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
      "GITHUB_LIST_JOBS_FOR_A_WORKFLOW_RUN",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub branches",
    preferredSlugs: [
      "GITHUB_LIST_BRANCHES",
      "GITHUB_GET_A_BRANCH",
      "GITHUB_CREATE_BRANCH",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub commits",
    preferredSlugs: [
      "GITHUB_GET_A_COMMIT",
      "GITHUB_LIST_COMMITS",
      "GITHUB_SEARCH_COMMITS",
    ],
  },
  {
    toolkit: "github",
    label: "GitHub repository contents",
    preferredSlugs: [
      "GITHUB_GET_REPOSITORY_CONTENT",
      "GITHUB_GET_RAW_REPOSITORY_CONTENT",
      "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
    ],
  },
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  try {
    const info = await stat(directoryPath);

    if (!info.isDirectory()) {
      throw new Error(`Expected a directory but found another file type: ${directoryPath}`);
    }

    return;
  } catch (error) {
    const code =
      isRecord(error) && typeof error.code === "string"
        ? error.code
        : null;

    if (code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(directoryPath, { recursive: true });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getToolSlug(tool: RawTool): string {
  return asString(tool.slug) ?? "<missing-slug>";
}

function getInputSchema(tool: RawTool): unknown {
  return tool.input_parameters ?? tool.inputParameters;
}

function getOutputSchema(tool: RawTool): unknown {
  return tool.output_parameters ?? tool.outputParameters;
}

function getAvailableVersions(tool: RawTool): string[] {
  return asStringArray(tool.available_versions ?? tool.availableVersions);
}

function getDeprecated(tool: RawTool): boolean {
  if (typeof tool.is_deprecated === "boolean") return tool.is_deprecated;
  if (typeof tool.isDeprecated === "boolean") return tool.isDeprecated;
  if (isRecord(tool.deprecated) && typeof tool.deprecated.is_deprecated === "boolean") {
    return tool.deprecated.is_deprecated;
  }
  return false;
}

function normalizeApiRoot(value: string | undefined): string {
  const base = (value?.trim() || "https://backend.composio.dev").replace(/\/+$/, "");
  if (base.endsWith("/api/v3.1")) return base;
  if (base.endsWith("/api/v3")) return `${base}.1`;
  return `${base}/api/v3.1`;
}

function requireApiKey(): string {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("COMPOSIO_API_KEY is not available to the retrieval process.");
  }
  return apiKey;
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(750 * 2 ** attempt, 10_000);
}

async function requestJson(url: URL, apiKey: string): Promise<JsonRecord> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-api-key": apiKey,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, null)));
      continue;
    }

    if (response.ok) {
      const body: unknown = await response.json();
      if (!isRecord(body)) {
        throw new Error(`Expected a JSON object from ${url.pathname}.`);
      }
      return body;
    }

    const retryable = response.status === 429 || response.status >= 500;
    const body = (await response.text()).slice(0, 1200);
    if (!retryable || attempt === maxAttempts - 1) {
      throw new Error(`Composio request failed for ${url.pathname} (HTTP ${response.status}): ${body}`);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, response.headers.get("retry-after"))));
  }

  throw new Error(`Composio request failed for ${url.pathname}.`);
}

function assertToolListPage(value: JsonRecord, toolkit: ToolkitSlug): ToolListPage {
  if (!Array.isArray(value.items)) {
    throw new Error(`Tool list response for ${toolkit} did not contain an items array.`);
  }
  if (!value.items.every(isRecord)) {
    throw new Error(`Tool list response for ${toolkit} contained a non-object tool definition.`);
  }
  if (value.next_cursor !== undefined && value.next_cursor !== null && typeof value.next_cursor !== "string") {
    throw new Error(`Tool list response for ${toolkit} returned an invalid next_cursor.`);
  }
  return value as ToolListPage;
}

async function fetchToolkitMetadata(
  toolkit: ToolkitSlug,
  apiRoot: string,
  apiKey: string,
): Promise<JsonRecord> {
  const url = new URL(`${apiRoot}/toolkits/${encodeURIComponent(toolkit)}`);
    url.searchParams.set("version", TOOLKIT_VERSION_SELECTOR);
    return requestJson(url, apiKey);
}

async function fetchToolPages(
  toolkit: ToolkitSlug,
  apiRoot: string,
  apiKey: string,
): Promise<ToolListPage[]> {
  const pages: ToolListPage[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const url = new URL(`${apiRoot}/tools`);
    url.searchParams.set("toolkit_slug", toolkit);
    url.searchParams.set("toolkit_versions", TOOLKIT_VERSION_SELECTOR);
    url.searchParams.set("include_deprecated", "true");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const page = assertToolListPage(await requestJson(url, apiKey), toolkit);
    pages.push(page);

    const nextCursor = page.next_cursor ?? undefined;
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`Pagination cursor repeated while retrieving ${toolkit}.`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return pages;
}

function flattenTools(pages: ToolListPage[]): RawTool[] {
  return pages.flatMap((page) => page.items);
}

function verifyCompleteness(toolkit: ToolkitSlug, pages: ToolListPage[], tools: RawTool[]): {
  duplicateSlugs: string[];
  toolsWithoutSlugs: number;
} {
  const declaredTotals = new Set(
    pages
      .map((page) => page.total_items)
      .filter((value): value is number => typeof value === "number" && Number.isInteger(value)),
  );
  if (declaredTotals.size > 1) {
    throw new Error(`Inconsistent total_items values were returned for ${toolkit}.`);
  }
  const [declaredTotal] = declaredTotals;
  if (declaredTotal !== undefined && declaredTotal !== tools.length) {
    throw new Error(
      `${toolkit} returned ${tools.length} tools, but the API declared total_items=${declaredTotal}.`,
    );
  }

  const declaredPageCounts = new Set(
    pages
      .map((page) => page.total_pages)
      .filter((value): value is number => typeof value === "number" && Number.isInteger(value)),
  );
  if (declaredPageCounts.size > 1) {
    throw new Error(`Inconsistent total_pages values were returned for ${toolkit}.`);
  }
  const [declaredPages] = declaredPageCounts;
  if (declaredPages !== undefined && declaredPages !== pages.length) {
    throw new Error(
      `${toolkit} returned ${pages.length} pages, but the API declared total_pages=${declaredPages}.`,
    );
  }

  const slugCounts = new Map<string, number>();
  let toolsWithoutSlugs = 0;
  for (const tool of tools) {
    const slug = asString(tool.slug);
    if (!slug) {
      toolsWithoutSlugs += 1;
      continue;
    }
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const duplicateSlugs = [...slugCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([slug]) => slug)
    .sort();

  if (toolsWithoutSlugs > 0 || duplicateSlugs.length > 0) {
    throw new Error(
      `${toolkit} completeness check failed: ${toolsWithoutSlugs} tools lacked slugs and ${duplicateSlugs.length} slugs were duplicated.`,
    );
  }

  return { duplicateSlugs, toolsWithoutSlugs };
}

function looksLikeFieldSchema(value: unknown): value is JsonRecord {
  return (
    isRecord(value) &&
    ("type" in value ||
      "description" in value ||
      "required" in value ||
      "$ref" in value ||
      "properties" in value ||
      "items" in value ||
      "enum" in value)
  );
}

function getSchemaFormat(schema: unknown): SchemaFormat {
  if (schema === undefined || schema === null) return "EMPTY";
  if (!isRecord(schema) || Object.keys(schema).length === 0) return "EMPTY";

  // v3.1 can return a direct parameter map where every root key is a field name.
  // Check this before JSON Schema keywords so legitimate fields named `type`,
  // `properties`, or `required` are not discarded.
  const entries = Object.entries(schema);
  if (entries.length > 0 && entries.every(([, value]) => looksLikeFieldSchema(value))) {
    return "FLAT_PARAMETER_MAP";
  }

  if (isRecord(schema.properties)) return "STANDARD_JSON_SCHEMA";
  if (schema.type === "array" || (typeof schema.type === "string" && schema.type !== "object")) {
    return "SCALAR_OR_ARRAY";
  }
  if (schema.type === "object" || Array.isArray(schema.required) || isRecord(schema.$defs)) {
    return "STANDARD_JSON_SCHEMA";
  }
  return "UNKNOWN";
}

function schemaPropertyMap(schema: unknown): Record<string, JsonRecord> {
  if (!isRecord(schema)) return {};
  if (getSchemaFormat(schema) === "FLAT_PARAMETER_MAP") {
    return Object.fromEntries(
      Object.entries(schema).filter((entry): entry is [string, JsonRecord] => looksLikeFieldSchema(entry[1])),
    );
  }
  if (isRecord(schema.properties)) {
    return Object.fromEntries(
      Object.entries(schema.properties).filter((entry): entry is [string, JsonRecord] => isRecord(entry[1])),
    );
  }
  return {};
}

function schemaRequiredNames(schema: unknown): Set<string> {
  if (!isRecord(schema)) return new Set();
  const required = new Set(asStringArray(schema.required));
  if (getSchemaFormat(schema) === "FLAT_PARAMETER_MAP") {
    for (const [name, field] of Object.entries(schemaPropertyMap(schema))) {
      if (field.required === true) required.add(name);
    }
  }
  return required;
}

function schemaType(schema: JsonRecord): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.filter((item) => typeof item === "string").join("|") || "unknown";
  if ("$ref" in schema) return "$ref";
  if (isRecord(schema.properties)) return "object";
  if (schema.items !== undefined) return "array";
  return "unknown";
}

function dereferenceLocal(schemaRoot: unknown, field: JsonRecord): JsonRecord {
  const ref = asString(field.$ref);
  if (!ref || !isRecord(schemaRoot)) return field;

  let definitions: JsonRecord | null = null;
  let definitionName: string | null = null;

  if (ref.startsWith("#/$defs/")) {
    definitions = isRecord(schemaRoot.$defs) ? schemaRoot.$defs : null;
    definitionName = ref.slice("#/$defs/".length);
  } else if (ref.startsWith("#/definitions/")) {
    definitions = isRecord(schemaRoot.definitions)
      ? schemaRoot.definitions
      : null;
    definitionName = ref.slice("#/definitions/".length);
  }

  if (!definitions || !definitionName) return field;

  const decodedName = decodeURIComponent(
    definitionName.replace(/~1/g, "/").replace(/~0/g, "~"),
  );
  const target = definitions[decodedName];

  if (!isRecord(target)) return field;

  const resolved: JsonRecord = {
    ...target,
    ...field,
  };

  // The reference has been resolved. Removing it prevents the resolved
  // object from immediately resolving itself again during recursion.
  delete resolved.$ref;

  return resolved;
}

function collectFields(
  schemaRoot: unknown,
  schema: unknown,
  basePath: string,
  parentRequired = false,
  visitedRefs = new Set<string>(),
  depth = 0,
): FieldSummary[] {
  if (!isRecord(schema) || depth > MAX_SCHEMA_DEPTH) return [];

  const fields: FieldSummary[] = [];
  const properties = schemaPropertyMap(schema);
  const requiredNames = schemaRequiredNames(schema);

  for (const [name, rawField] of Object.entries(properties)) {
    const pathValue = basePath ? `${basePath}.${name}` : name;
    const required =
      parentRequired ||
      requiredNames.has(name) ||
      rawField.required === true;

    const ref = asString(rawField.$ref);
    const refAlreadyVisited = ref !== null && visitedRefs.has(ref);
    const field = refAlreadyVisited
      ? rawField
      : dereferenceLocal(schemaRoot, rawField);

    const nestedProperties = schemaPropertyMap(field);
    const nested =
      Object.keys(nestedProperties).length > 0 ||
      field.items !== undefined ||
      Boolean(ref);

    fields.push({
      path: pathValue,
      name,
      type: schemaType(field),
      description:
        asString(field.description) ??
        asString(rawField.description) ??
        "",
      required,
      nested,
    });

    if (refAlreadyVisited) continue;

    const nextVisitedRefs = new Set(visitedRefs);
    if (ref) nextVisitedRefs.add(ref);

    if (Object.keys(nestedProperties).length > 0) {
      fields.push(
        ...collectFields(
          schemaRoot,
          field,
          pathValue,
          required,
          nextVisitedRefs,
          depth + 1,
        ),
      );
    }

    if (isRecord(field.items)) {
      const rawItems = field.items;
      const itemRef = asString(rawItems.$ref);

      if (!itemRef || !nextVisitedRefs.has(itemRef)) {
        const itemVisitedRefs = new Set(nextVisitedRefs);
        if (itemRef) itemVisitedRefs.add(itemRef);

        const items = dereferenceLocal(schemaRoot, rawItems);

        fields.push(
          ...collectFields(
            schemaRoot,
            items,
            `${pathValue}[]`,
            required,
            itemVisitedRefs,
            depth + 1,
          ),
        );
      }
    }

    if (Array.isArray(field.items)) {
      for (const [index, rawItem] of field.items.entries()) {
        if (!isRecord(rawItem)) continue;

        const itemRef = asString(rawItem.$ref);
        if (itemRef && nextVisitedRefs.has(itemRef)) continue;

        const itemVisitedRefs = new Set(nextVisitedRefs);
        if (itemRef) itemVisitedRefs.add(itemRef);

        const item = dereferenceLocal(schemaRoot, rawItem);

        fields.push(
          ...collectFields(
            schemaRoot,
            item,
            `${pathValue}[${index}]`,
            required,
            itemVisitedRefs,
            depth + 1,
          ),
        );
      }
    }
  }

  if (Object.keys(properties).length === 0 && isRecord(schema.items)) {
    const itemRef = asString(schema.items.$ref);

    if (!itemRef || !visitedRefs.has(itemRef)) {
      const nextVisitedRefs = new Set(visitedRefs);
      if (itemRef) nextVisitedRefs.add(itemRef);

      const items = dereferenceLocal(schemaRoot, schema.items);

      fields.push(
        ...collectFields(
          schemaRoot,
          items,
          `${basePath}[]`,
          parentRequired,
          nextVisitedRefs,
          depth + 1,
        ),
      );
    }
  }

  return fields;
}

function classifyOutput(schema: unknown): { classification: OutputClassification; reasons: string[] } {
  const format = getSchemaFormat(schema);
  if (format === "EMPTY") {
    return { classification: "MISSING", reasons: ["No declared output schema."] };
  }

  if (!isRecord(schema)) {
    return { classification: "MISSING", reasons: ["Output schema is not an object."] };
  }

  const fields = collectFields(schema, schema, "");
  const topLevel = fields.filter((field) => !field.path.includes(".") && !field.path.includes("[]"));
  const specificFields = fields.filter((field) => !GENERIC_FIELD_NAMES.has(field.name.toLowerCase()));
  const typedFields = fields.filter((field) => field.type !== "unknown");
  const describedFields = fields.filter((field) => field.description.trim().length > 0);
  const hasBroadAdditionalProperties = schema.additionalProperties === true || isRecord(schema.additionalProperties);
  const topLevelOnlyGeneric =
    topLevel.length > 0 && topLevel.every((field) => GENERIC_FIELD_NAMES.has(field.name.toLowerCase()));
  const hasStructuredNestedData = fields.some((field) => field.path.includes(".") || field.path.includes("[]"));

  if (fields.length === 0) {
    if (format === "SCALAR_OR_ARRAY" && schemaType(schema) !== "unknown") {
      return {
        classification: "PARTIAL",
        reasons: ["Typed scalar or array output has no named resource fields."],
      };
    }
    return {
      classification: "GENERIC",
      reasons: ["Schema exists but has no named output properties."],
    };
  }

  if (hasBroadAdditionalProperties && specificFields.length === 0) {
    return {
      classification: "GENERIC",
      reasons: ["Output relies on broad additionalProperties without named resource fields."],
    };
  }

  if (topLevelOnlyGeneric && !hasStructuredNestedData) {
    return {
      classification: "GENERIC",
      reasons: ["Only generic envelope fields are declared and their nested resource shape is unavailable."],
    };
  }

  const typedRatio = typedFields.length / fields.length;
  const describedRatio = describedFields.length / fields.length;
  if (
    specificFields.length > 0 &&
    typedRatio >= 0.75 &&
    describedRatio >= 0.5 &&
    !hasBroadAdditionalProperties
  ) {
    return {
      classification: "COMPLETE",
      reasons: ["Named resource fields are present with mostly typed and described structure."],
    };
  }

  const reasons: string[] = [];
  if (topLevelOnlyGeneric) reasons.push("Top-level output is a generic wrapper around nested data.");
  if (typedRatio < 0.75) reasons.push("Some declared output fields do not have a concrete type.");
  if (describedRatio < 0.5) reasons.push("Many output fields lack descriptions.");
  if (hasBroadAdditionalProperties) reasons.push("Part of the output is open-ended through additionalProperties.");
  if (specificFields.length === 0) reasons.push("No service-specific output field names were found.");
  if (reasons.length === 0) reasons.push("The output has usable structure, but not enough evidence for COMPLETE.");
  return { classification: "PARTIAL", reasons };
}

function inspectTool(tool: RawTool): ToolInspection {
  const inputSchema = getInputSchema(tool);
  const outputSchema = getOutputSchema(tool);
  const allInputs = collectFields(inputSchema, inputSchema, "");
  const allOutputs = collectFields(outputSchema, outputSchema, "");
  const outputClassification = classifyOutput(outputSchema);
  const requiredInputs = allInputs.filter((field) => field.required && !field.path.includes("."));
  const optionalInputs = allInputs.filter((field) => !field.required && !field.path.includes("."));
  const nestedInputs = allInputs.filter((field) => field.path.includes(".") || field.path.includes("[]"));

  const unsafeReasons: string[] = [];
  if (outputClassification.classification === "MISSING") {
    unsafeReasons.push("No output schema is available to prove producer paths.");
  }
  if (outputClassification.classification === "GENERIC") {
    unsafeReasons.push("Output shape is too generic to infer identifier producers safely.");
  }
  const ambiguousRequired = requiredInputs.filter(
    (field) =>
      AMBIGUOUS_INPUT_NAMES.has(field.name.toLowerCase()) &&
      !/(issue|pull|request|thread|message|event|calendar|file|folder|repo|repository|workflow|run|commit|branch|contact|user|owner)/i.test(
        field.description,
      ),
  );
  if (ambiguousRequired.length > 0) {
    unsafeReasons.push(
      `Ambiguous required input names without enough resource context: ${ambiguousRequired
        .map((field) => field.name)
        .join(", ")}.`,
    );
  }
  if (allOutputs.some((field) => ["id", "number"].includes(field.name.toLowerCase()) && !field.description)) {
    unsafeReasons.push("Generic output id/number fields lack descriptions.");
  }

  return {
    slug: getToolSlug(tool),
    name: asString(tool.name) ?? "",
    description: asString(tool.description) ?? "",
    inputFormat: getSchemaFormat(inputSchema),
    outputFormat: getSchemaFormat(outputSchema),
    requiredInputs,
    optionalInputs,
    nestedInputs,
    outputFields: allOutputs,
    outputClassification: outputClassification.classification,
    outputClassificationReasons: outputClassification.reasons,
    version: asString(tool.version),
    availableVersions: getAvailableVersions(tool),
    deprecated: getDeprecated(tool),
    scopes: asStringArray(tool.scopes),
    tags: asStringArray(tool.tags),
    unsafeReasons,
  };
}

function emptyClassificationCounts(): Record<OutputClassification, number> {
  return { COMPLETE: 0, PARTIAL: 0, GENERIC: 0, MISSING: 0 };
}

function emptyFormatCounts(): Record<SchemaFormat, number> {
  return {
    STANDARD_JSON_SCHEMA: 0,
    FLAT_PARAMETER_MAP: 0,
    SCALAR_OR_ARRAY: 0,
    EMPTY: 0,
    UNKNOWN: 0,
  };
}

function representativeScore(inspection: ToolInspection): number {
  let score = 0;
  if (/_(LIST|GET|FETCH|FIND|SEARCH)_/.test(`_${inspection.slug}_`)) score += 5;
  if (/_(CREATE|SEND|REPLY|MERGE|UPDATE|DISPATCH)_/.test(`_${inspection.slug}_`)) score += 4;
  if (inspection.outputClassification === "COMPLETE") score += 3;
  if (inspection.outputClassification === "PARTIAL") score += 2;
  if (inspection.deprecated) score -= 5;
  if (/GRAPHQL/i.test(inspection.slug)) score -= 1;
  return score;
}

function chooseRepresentatives(
  toolkit: ToolkitSlug,
  inspections: ToolInspection[],
): Map<string, ToolInspection[]> {
  const result = new Map<string, ToolInspection[]>();
  const inspectionsBySlug = new Map(
    inspections.map((inspection) => [inspection.slug, inspection]),
  );

  for (const group of REPRESENTATIVE_GROUPS.filter(
    (candidate) => candidate.toolkit === toolkit,
  )) {
    const selected = group.preferredSlugs
      .map((slug) => inspectionsBySlug.get(slug))
      .filter(
        (inspection): inspection is ToolInspection =>
          inspection !== undefined,
      );

    result.set(group.label, selected);
  }

  return result;
}

function extractToolkitMetadataVersion(metadata: JsonRecord): { version: string | null; availableVersions: string[] } {
  const meta = isRecord(metadata.meta) ? metadata.meta : metadata;
  return {
    version: asString(meta.version),
    availableVersions: asStringArray(meta.available_versions ?? meta.availableVersions),
  };
}

function compareSlugSets(restTools: RawTool[], sdkTools: unknown[]): "MATCH" | "SDK_TRUNCATED" | "MISMATCH" {
  const restSlugs = new Set(restTools.map(getToolSlug));
  const sdkSlugs = new Set(
    sdkTools
      .filter(isRecord)
      .map((tool) => asString(tool.slug))
      .filter((slug): slug is string => slug !== null),
  );
  if (restSlugs.size === sdkSlugs.size && [...restSlugs].every((slug) => sdkSlugs.has(slug))) return "MATCH";
  if (restTools.length > PAGE_LIMIT && sdkTools.length === PAGE_LIMIT) return "SDK_TRUNCATED";
  return "MISMATCH";
}

async function writeJson(filePath: string, value: unknown): Promise<number> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return (await stat(filePath)).size;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function summarizeFields(fields: FieldSummary[], max = 12): string {
  if (fields.length === 0) return "None declared";
  const values = fields.slice(0, max).map((field) => {
    const description = field.description ? ` — ${field.description}` : "";
    return `\`${field.path}\` (${field.type})${description}`;
  });
  if (fields.length > max) values.push(`… ${fields.length - max} more`);
  return values.join("; ");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function servicePrefixCounts(tools: RawTool[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const slug = getToolSlug(tool);
    const suffix = slug.replace(/^GOOGLESUPER_/, "");
    let service = "other";
    if (/GMAIL|EMAIL|THREAD|LABEL|DRAFT|FILTER/i.test(suffix)) service = "gmail";
    else if (/CALENDAR|EVENT|ACL|FREE_BUSY/i.test(suffix)) service = "calendar";
    else if (/DRIVE|FILE|FOLDER|PERMISSION|COMMENT|REPLY|CHANGE/i.test(suffix)) service = "drive";
    else if (/CONTACT|PEOPLE|PERSON/i.test(suffix)) service = "people/contacts";
    else if (/DOCUMENT|DOCS|TAB|FOOTNOTE|HEADER|FOOTER|NAMED_RANGE/i.test(suffix)) service = "docs";
    else if (/SHEET|SPREADSHEET|CELL|ROW|COLUMN/i.test(suffix)) service = "sheets";
    else if (/SLIDE|PRESENTATION/i.test(suffix)) service = "slides";
    else if (/TASK/i.test(suffix)) service = "tasks";
    else if (/MEET|CONFERENCE|SPACE/i.test(suffix)) service = "meet";
    else if (/ANALYTICS|AUDIENCE|REPORT|PROPERTY/i.test(suffix)) service = "analytics";
    counts.set(service, (counts.get(service) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function buildObservations(results: ToolkitResult[], fetchedAt: string): string {
  const lines: string[] = [];
  lines.push("# Raw Tool Schema Observations", "");
  lines.push(`Generated by \`bun run fetch:tools\` at ${fetchedAt}.`, "");
  lines.push("## Retrieval verification", "");
  lines.push("| Toolkit | Tools | Pages | Pagination required | SDK cross-check | Toolkit version(s) | Metadata version | Raw file size |", "|---|---:|---:|---|---|---|---|---:|");
  for (const result of results) {
    lines.push(
      `| ${result.toolkit} | ${result.tools.length} | ${result.snapshot.tool_list_responses.length} | ${result.paginationRequired ? "Yes" : "No"} | ${result.sdkCrossCheck} (${result.sdkCount}) | ${markdownCell(result.versions.join(", ") || "not returned")} | ${result.metadataVersion ?? "not returned"} | ${formatBytes(result.rawSizeBytes)} |`,
    );
  }
  lines.push("");
  lines.push(
    "The raw JSON files preserve every parsed field returned by the toolkit metadata endpoint and every page returned by the tools endpoint. API page objects are stored unchanged inside `tool_list_responses`; the surrounding snapshot metadata records the request that produced them.",
    "",
  );

  lines.push("## What a raw tool definition contains", "");
  lines.push(
    "Across the inspected definitions, a tool can contain its slug, name, description, toolkit metadata, input schema, output schema, tags, OAuth scopes, current version, available versions, no-auth status, and deprecation metadata. Input and output schemas are usually JSON Schema objects with `type`, `properties`, `required`, nested objects/arrays, `$ref`, and `$defs`, but the script also detects flat parameter maps, scalar/array schemas, empty schemas, and unknown shapes.",
    "",
  );

  lines.push("## Output schema quality", "");
  lines.push("The classifications below are deterministic schema-quality heuristics, not claims that the underlying APIs always return every field at runtime.", "");
  lines.push("| Toolkit | COMPLETE | PARTIAL | GENERIC | MISSING |", "|---|---:|---:|---:|---:|");
  for (const result of results) {
    const counts = result.outputCounts;
    lines.push(`| ${result.toolkit} | ${counts.COMPLETE} | ${counts.PARTIAL} | ${counts.GENERIC} | ${counts.MISSING} |`);
  }
  lines.push("");
  lines.push(
    "- `COMPLETE`: named resource fields are present with mostly typed and described structure.",
    "- `PARTIAL`: useful structure exists, but some nested shape, typing, or descriptions are incomplete.",
    "- `GENERIC`: only a generic envelope or open-ended object is available, without reliable resource paths.",
    "- `MISSING`: no declared output schema is present.",
    "",
  );

  lines.push("## Schema format counts", "");
  for (const result of results) {
    lines.push(`### ${result.toolkit}`, "");
    lines.push("| Format | Inputs | Outputs |", "|---|---:|---:|");
    for (const format of Object.keys(result.inputFormatCounts) as SchemaFormat[]) {
      lines.push(`| ${format} | ${result.inputFormatCounts[format]} | ${result.outputFormatCounts[format]} |`);
    }
    lines.push("");
  }

  lines.push("## Representative schema examples", "");
  for (const result of results) {
    lines.push(`### ${result.toolkit}`, "");
    for (const [label, inspections] of result.representative.entries()) {
      lines.push(`#### ${label}`, "");
      if (inspections.length === 0) {
        lines.push("No matching representative tool was found.", "");
        continue;
      }
      for (const inspection of inspections) {
        lines.push(`##### \`${inspection.slug}\` — ${inspection.outputClassification}`, "");
        lines.push(
          `- Description: ${inspection.description || "Not returned"}`,
          `- Required inputs: ${summarizeFields(inspection.requiredInputs)}`,
          `- Optional inputs: ${summarizeFields(inspection.optionalInputs)}`,
          `- Nested inputs: ${summarizeFields(inspection.nestedInputs)}`,
          `- Output fields: ${summarizeFields(inspection.outputFields)}`,
          `- Output assessment: ${inspection.outputClassificationReasons.join(" ")}`,
          `- Version: ${inspection.version ?? "not returned"}; available versions: ${inspection.availableVersions.join(", ") || "not returned"}`,
          `- Deprecated: ${inspection.deprecated ? "yes" : "no"}; scopes: ${inspection.scopes.join(", ") || "none returned"}`,
          "",
        );
      }
    }
  }

  lines.push("## Inconsistencies affecting dependency extraction", "");
  for (const result of results) {
    const unsafe = result.inspections.filter((inspection) => inspection.unsafeReasons.length > 0);
    const deprecatedCount = result.inspections.filter((inspection) => inspection.deprecated).length;
    const graphqlCount = result.inspections.filter((inspection) => /GRAPHQL/i.test(`${inspection.slug} ${inspection.description}`)).length;
    const genericIdCount = result.inspections.filter((inspection) =>
      inspection.outputFields.some((field) => ["id", "number"].includes(field.name.toLowerCase())),
    ).length;
    const missingDescriptions = result.inspections.filter((inspection) =>
      inspection.outputFields.some((field) => field.description.length === 0),
    ).length;

    lines.push(`### ${result.toolkit}`, "");
    lines.push(
      `- Deprecated tools: ${deprecatedCount}.`,
      `- Tools with REST/GraphQL indicators: ${graphqlCount}.`,
      `- Tools exposing generic output fields named \`id\` or \`number\`: ${genericIdCount}.`,
      `- Tools with at least one output field lacking a description: ${missingDescriptions}.`,
      `- Tools flagged as unsafe for automatic dependency inference without additional evidence: ${unsafe.length}.`,
    );
    if (result.toolkit === "googlesuper") {
      lines.push("- Google Super combines multiple services with different identifier conventions and schema depth:");
      for (const [service, count] of servicePrefixCounts(result.tools)) {
        lines.push(`  - ${service}: ${count}`);
      }
    } else {
      lines.push(
        "- GitHub includes high-level convenience actions and low-level Git object operations; repository file actions can overlap with blob/tree/commit/reference workflows.",
        "- GitHub also contains scope-specific variants for users, repositories, organizations, teams, environments, and authenticated-user resources.",
      );
    }
    lines.push("");
  }

  lines.push("## Schemas that cannot safely support dependency inference", "");
  for (const result of results) {
    const unsafe = result.inspections.filter((inspection) => inspection.unsafeReasons.length > 0);
    lines.push(`### ${result.toolkit}: ${unsafe.length} flagged tools`, "");
    for (const inspection of unsafe.slice(0, 40)) {
      lines.push(`- \`${inspection.slug}\`: ${inspection.unsafeReasons.join(" ")}`);
    }
    if (unsafe.length > 40) lines.push(`- … ${unsafe.length - 40} additional flagged tools are present in the raw data.`);
    lines.push("");
  }

  lines.push("## Important limitations", "");
  lines.push(
    "- A declared output path proves only that the schema exposes the field; it does not prove that every successful execution populates it.",
    "- Generic wrappers such as `data`, `successful`, and `error` are not themselves useful dependency entities unless `$ref`/`$defs` expose the nested resource shape.",
    "- Fields named `id`, `number`, `name`, `path`, or `ref` must not be matched across tools without service, resource, and scope evidence.",
    "- Deprecated tools, REST/GraphQL variants, and convenience/low-level overlaps should be resolved deliberately in the next phase rather than treated as equivalent.",
    "- This phase does not normalize schemas, infer dependencies, call an LLM, plan workflows, or build a visualization.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function buildStatus(results: ToolkitResult[], fetchedAt: string): string {
  const lines: string[] = [];
  lines.push("# Implementation Status", "");
  lines.push(`Last updated: ${fetchedAt}`, "");
  lines.push("## Work completed", "");
  lines.push(
    "- Added authenticated raw-schema retrieval for `googlesuper` and `github`.",
    "- Added cursor pagination and response-total verification.",
    "- Preserved toolkit metadata and every untouched tool-list page in separate raw JSON snapshots.",
    "- Cross-checked the direct REST result against the existing `Composio` SDK client.",
    "- Inspected representative Gmail, People/Contacts, Calendar, Drive, repository, issue, pull-request, Actions, branch, commit, and file tools.",
    "- Classified output schemas as COMPLETE, PARTIAL, GENERIC, or MISSING using documented deterministic heuristics.",
    "- Generated schema observations and this status file.",
    "",
  );

  lines.push("## Commands run", "", "```bash", "bun run fetch:tools", "```", "");
  lines.push("## Files created or changed", "");
  lines.push(
    "- `src/fetch-tools.ts`",
    "- `package.json` (`fetch:tools` script)",
    "- `data/raw/googlesuper-tools.json`",
    "- `data/raw/github-tools.json`",
    "- `docs/schema-observations.md`",
    "- `IMPLEMENTATION_STATUS.md`",
    "",
  );

  lines.push("## Verified retrieval results", "");
  lines.push("| Toolkit | Tools | Pages | Pagination | Versions | Raw size | Output counts (C/P/G/M) |", "|---|---:|---:|---|---|---:|---|");
  for (const result of results) {
    const counts = result.outputCounts;
    lines.push(
      `| ${result.toolkit} | ${result.tools.length} | ${result.snapshot.tool_list_responses.length} | ${result.paginationRequired ? "required" : "not required"} | ${markdownCell(result.versions.join(", ") || result.metadataVersion || "not returned")} | ${formatBytes(result.rawSizeBytes)} | ${counts.COMPLETE}/${counts.PARTIAL}/${counts.GENERIC}/${counts.MISSING} |`,
    );
  }
  lines.push("");

  lines.push("## Important findings", "");
  for (const result of results) {
    const unsafeCount = result.inspections.filter((inspection) => inspection.unsafeReasons.length > 0).length;
    lines.push(
      `- ${result.toolkit}: SDK cross-check ${result.sdkCrossCheck}; ${unsafeCount} tools require additional evidence before their outputs can support dependency edges.`,
    );
  }
  lines.push(
    "- Raw tool schemas can include nested JSON Schema, `$ref`/`$defs`, generic wrappers, empty outputs, deprecated tools, and ambiguous identifier fields.",
    "- Google Super must later be separated by underlying Google service rather than treated as one resource namespace.",
    "- GitHub requires careful separation of REST/GraphQL variants, scope-specific resources, and convenience versus low-level Git operations.",
    "",
  );

  lines.push("## Unresolved risks", "");
  lines.push(
    "- `latest` is intentionally used for acquisition, so rerunning later can change tool counts, versions, or schemas.",
    "- A COMPLETE classification means structurally rich schema evidence, not guaranteed runtime population of every field.",
    "- Generic identifiers and wrapper fields cannot be used as dependency edges without canonical resource and scope evidence.",
    "- Some deprecated or overlapping tools may require explicit preference rules in a later phase.",
    "",
  );

  lines.push("## Recommended focus for the next implementation phase", "");
  lines.push(
    "Build a lossless normalizer that preserves exact input/output JSON paths, `$ref` evidence, toolkit version, underlying service, resource family, scope, deprecation status, and schema-quality classification. Do not infer an edge unless the producer path exists in the saved raw schema.",
    "",
  );

  lines.push("## Phase boundary", "");
  lines.push(
    "No normalization, dependency matching, LLM classification, workflow planning, or visualization was implemented in this phase.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function processToolkit(
  toolkit: ToolkitSlug,
  composio: Composio,
  apiRoot: string,
  apiKey: string,
  fetchedAt: string,
): Promise<ToolkitResult> {
  console.log(`Fetching ${toolkit} raw tool definitions...`);
  const [toolkitMetadata, pages, sdkTools] = await Promise.all([
    fetchToolkitMetadata(toolkit, apiRoot, apiKey),
    fetchToolPages(toolkit, apiRoot, apiKey),
    composio.tools.getRawComposioTools({
      toolkits: [toolkit],
      limit: PAGE_LIMIT,
      important: false,
    }),
  ]);

  const tools = flattenTools(pages);
  const completeness = verifyCompleteness(toolkit, pages, tools);
  const sdkCrossCheck = compareSlugSets(tools, sdkTools as unknown[]);
  if (sdkCrossCheck === "MISMATCH" && tools.length <= PAGE_LIMIT) {
    throw new Error(
      `${toolkit} direct REST result did not match the existing Composio SDK result. Refusing to mark retrieval complete.`,
    );
  }

  const snapshot: ToolkitSnapshot = {
    snapshot_format: "composio-raw-tool-responses-v1",
    retrieval: {
      endpoint: `${apiRoot}/tools`,
      toolkit_slug: toolkit,
      toolkit_versions: TOOLKIT_VERSION_SELECTOR,
      include_deprecated: true,
      page_limit: PAGE_LIMIT,
      fetched_at: fetchedAt,
    },
    toolkit_metadata_response: toolkitMetadata,
    tool_list_responses: pages,
  };

  const rawPath = path.join(RAW_DIR, `${toolkit}-tools.json`);
  const rawSizeBytes = await writeJson(rawPath, snapshot);
  const inspections = tools.map(inspectTool);
  const representative = chooseRepresentatives(toolkit, inspections);
  const missingRepresentativeGroups = [...representative.entries()]
    .filter(([, selected]) => selected.length === 0)
    .map(([label]) => label);
  if (missingRepresentativeGroups.length > 0) {
    throw new Error(
      `${toolkit} representative inspection failed for: ${missingRepresentativeGroups.join(", ")}.`,
    );
  }

  const outputCounts = emptyClassificationCounts();
  const inputFormatCounts = emptyFormatCounts();
  const outputFormatCounts = emptyFormatCounts();
  for (const inspection of inspections) {
    outputCounts[inspection.outputClassification] += 1;
    inputFormatCounts[inspection.inputFormat] += 1;
    outputFormatCounts[inspection.outputFormat] += 1;
  }

  const versions = [...new Set(inspections.map((inspection) => inspection.version).filter((value): value is string => value !== null))].sort();
  const availableVersions = [...new Set(inspections.flatMap((inspection) => inspection.availableVersions))].sort();
  const metadataVersions = extractToolkitMetadataVersion(toolkitMetadata);

  return {
    toolkit,
    snapshot,
    tools,
    outputCounts,
    inputFormatCounts,
    outputFormatCounts,
    inspections,
    representative,
    rawPath,
    rawSizeBytes,
    paginationRequired: pages.length > 1,
    sdkCount: (sdkTools as unknown[]).length,
    sdkCrossCheck,
    versions,
    availableVersions,
    metadataVersion: metadataVersions.version,
    metadataAvailableVersions: metadataVersions.availableVersions,
    duplicateSlugs: completeness.duplicateSlugs,
    toolsWithoutSlugs: completeness.toolsWithoutSlugs,
  };
}

async function main(): Promise<void> {
  const apiKey = requireApiKey();
  const apiRoot = normalizeApiRoot(process.env.COMPOSIO_BASE_URL);
  const fetchedAt = new Date().toISOString();
  await ensureDirectory(RAW_DIR);
  await ensureDirectory(path.dirname(OBSERVATIONS_PATH));

  // Reuses the same public Composio client construction already used by src/index.ts.
  // The direct REST calls are used only because getRawComposioTools returns transformed
  // SDK objects and does not expose page envelopes/cursors needed for raw preservation.
  const composio = new Composio({
    apiKey,
    toolkitVersions: TOOLKIT_VERSION_SELECTOR,
    });

  const results: ToolkitResult[] = [];
  for (const toolkit of TOOLKITS) {
    results.push(await processToolkit(toolkit, composio, apiRoot, apiKey, fetchedAt));
  }

  await writeFile(OBSERVATIONS_PATH, buildObservations(results, fetchedAt), "utf8");
  await writeFile(STATUS_PATH, buildStatus(results, fetchedAt), "utf8");

  console.log("");
  console.log("Raw tool retrieval verified:");
  for (const result of results) {
    const counts = result.outputCounts;
    console.log(
      `${result.toolkit}: ${result.tools.length} tools; ${result.snapshot.tool_list_responses.length} page(s); ` +
        `pagination ${result.paginationRequired ? "required" : "not required"}; versions ` +
        `${result.versions.join(", ") || result.metadataVersion || "not returned"}; ` +
        `${formatBytes(result.rawSizeBytes)}; outputs COMPLETE=${counts.COMPLETE}, PARTIAL=${counts.PARTIAL}, ` +
        `GENERIC=${counts.GENERIC}, MISSING=${counts.MISSING}; SDK cross-check=${result.sdkCrossCheck}.`,
    );
  }
  console.log(`Observations: ${path.relative(process.cwd(), OBSERVATIONS_PATH)}`);
  console.log(`Status: ${path.relative(process.cwd(), STATUS_PATH)}`);
}

main().catch((error: unknown) => {
  console.error("fetch:tools failed:");
  console.error(error);
  process.exitCode = 1;
});