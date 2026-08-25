type JsonRecord = Record<string, unknown>;

type Target = {
  toolkit: "googlesuper" | "github";
  slug: string;
  category: string;
};

type FieldRow = {
  path: string;
  type: string[];
  required: boolean;
  nullable: boolean;
  array: boolean;
  itemType: string[];
  description: string;
  ref: string | null;
  refTargetFound: boolean;
  composition: string[];
  enumValues: unknown[];
  format: string | null;
};

const TARGETS: Target[] = [
  {
    toolkit: "googlesuper",
    category: "Gmail messages",
    slug: "GOOGLESUPER_LIST_MESSAGES",
  },
  {
    toolkit: "googlesuper",
    category: "Gmail threads",
    slug: "GOOGLESUPER_LIST_THREADS",
  },
  {
    toolkit: "googlesuper",
    category: "Google People or Contacts",
    slug: "GOOGLESUPER_SEARCH_PEOPLE",
  },
  {
    toolkit: "googlesuper",
    category: "Google Calendar",
    slug: "GOOGLESUPER_EVENTS_LIST",
  },
  {
    toolkit: "googlesuper",
    category: "Google Drive",
    slug: "GOOGLESUPER_LIST_FILES",
  },
  {
    toolkit: "github",
    category: "GitHub repositories",
    slug: "GITHUB_FIND_REPOSITORIES",
  },
  {
    toolkit: "github",
    category: "GitHub issues",
    slug: "GITHUB_LIST_REPOSITORY_ISSUES",
  },
  {
    toolkit: "github",
    category: "GitHub pull requests",
    slug: "GITHUB_FIND_PULL_REQUESTS",
  },
  {
    toolkit: "github",
    category: "GitHub workflows",
    slug: "GITHUB_LIST_REPOSITORY_WORKFLOWS",
  },
  {
    toolkit: "github",
    category: "GitHub workflow runs",
    slug: "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
  },
  {
    toolkit: "github",
    category: "GitHub branches",
    slug: "GITHUB_LIST_BRANCHES",
  },
  {
    toolkit: "github",
    category: "GitHub commits",
    slug: "GITHUB_LIST_COMMITS",
  },
  {
    toolkit: "github",
    category: "GitHub repository contents",
    slug: "GITHUB_GET_REPOSITORY_CONTENT",
  },
];

const MAX_DEPTH = 8;
const MAX_FIELDS_PER_SCHEMA = 160;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function schemaLocation(
  tool: JsonRecord,
  snakeCase: string,
  camelCase: string,
): string | null {
  if (tool[snakeCase] !== undefined) return snakeCase;
  if (tool[camelCase] !== undefined) return camelCase;
  return null;
}

function getSchema(
  tool: JsonRecord,
  snakeCase: string,
  camelCase: string,
): unknown {
  return tool[snakeCase] ?? tool[camelCase];
}

function schemaTypes(schema: JsonRecord): string[] {
  if (typeof schema.type === "string") {
    return [schema.type];
  }

  if (Array.isArray(schema.type)) {
    return schema.type.filter(
      (item): item is string => typeof item === "string",
    );
  }

  if (schema.$ref !== undefined) {
    return ["$ref"];
  }

  if (isRecord(schema.properties)) {
    return ["object"];
  }

  if (schema.items !== undefined) {
    return ["array"];
  }

  return ["unknown"];
}

function itemTypes(schema: JsonRecord): string[] {
  if (!isRecord(schema.items)) return [];
  return schemaTypes(schema.items);
}

function compositionKeywords(schema: JsonRecord): string[] {
  const result: string[] = [];

  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    if (Array.isArray(schema[keyword])) {
      result.push(`${keyword}:${schema[keyword].length}`);
    }
  }

  return result;
}

function unescapeJsonPointerPart(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolveLocalRef(root: unknown, ref: string): JsonRecord | null {
  if (!isRecord(root) || !ref.startsWith("#/")) return null;

  const parts = ref
    .slice(2)
    .split("/")
    .map(unescapeJsonPointerPart);

  let current: unknown = root;

  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) {
      return null;
    }

    current = current[part];
  }

  return isRecord(current) ? current : null;
}

function propertyMap(schema: JsonRecord): Record<string, JsonRecord> {
  if (isRecord(schema.properties)) {
    return Object.fromEntries(
      Object.entries(schema.properties).filter(
        (entry): entry is [string, JsonRecord] => isRecord(entry[1]),
      ),
    );
  }

  const ignoredRootKeys = new Set([
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
  ]);

    const entries: Array<[string, JsonRecord]> = [];

    for (const [key, value] of Object.entries(schema)) {
    if (ignoredRootKeys.has(key) || !isRecord(value)) {
        continue;
    }

    const looksLikeSchema =
        "type" in value ||
        "description" in value ||
        "$ref" in value ||
        "properties" in value ||
        "items" in value ||
        "allOf" in value ||
        "anyOf" in value ||
        "oneOf" in value;

    if (looksLikeSchema) {
        entries.push([key, value]);
    }
    }

    return Object.fromEntries(entries);
}

function flattenSchema(root: unknown): {
  fields: FieldRow[];
  truncated: boolean;
} {
  const fields: FieldRow[] = [];
  const activeRefs = new Set<string>();
  let truncated = false;

  function visit(
    schema: unknown,
    path: string,
    required: boolean,
    depth: number,
  ): void {
    if (
      !isRecord(schema) ||
      depth > MAX_DEPTH ||
      fields.length >= MAX_FIELDS_PER_SCHEMA
    ) {
      if (fields.length >= MAX_FIELDS_PER_SCHEMA) {
        truncated = true;
      }
      return;
    }

    const ref = stringValue(schema.$ref);
    const resolvedRef = ref ? resolveLocalRef(root, ref) : null;

    fields.push({
      path: path || "$",
      type: schemaTypes(schema),
      required,
      nullable:
        schema.nullable === true ||
        schemaTypes(schema).includes("null"),
      array:
        schema.type === "array" ||
        schema.items !== undefined,
      itemType: itemTypes(schema),
      description: stringValue(schema.description) ?? "",
      ref,
      refTargetFound: resolvedRef !== null,
      composition: compositionKeywords(schema),
      enumValues: Array.isArray(schema.enum) ? schema.enum : [],
      format: stringValue(schema.format),
    });

    if (ref && resolvedRef && !activeRefs.has(ref)) {
      activeRefs.add(ref);
      visit(resolvedRef, `${path || "$"}->$ref`, required, depth + 1);
      activeRefs.delete(ref);
    }

    const requiredNames = new Set(stringArray(schema.required));

    for (const [name, child] of Object.entries(propertyMap(schema))) {
      const childPath = path && path !== "$"
        ? `${path}.${name}`
        : name;

      visit(
        child,
        childPath,
        requiredNames.has(name) || child.required === true,
        depth + 1,
      );
    }

    if (isRecord(schema.items)) {
      visit(
        schema.items,
        path && path !== "$" ? `${path}[]` : "$[]",
        required,
        depth + 1,
      );
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branches = schema[keyword];

      if (!Array.isArray(branches)) continue;

      branches.forEach((branch, index) => {
        visit(
          branch,
          `${path || "$"}.${keyword}[${index}]`,
          required,
          depth + 1,
        );
      });
    }
  }

  visit(root, "$", false, 0);

  return {
    fields,
    truncated,
  };
}

function schemaSummary(schema: unknown): JsonRecord {
  if (!isRecord(schema)) {
    return {
      exists: false,
      valueType: schema === null ? "null" : typeof schema,
    };
  }

  const flattened = flattenSchema(schema);

  return {
    exists: true,
    rootKeys: Object.keys(schema),
    rootType: schemaTypes(schema),
    rootRequired: stringArray(schema.required),
    defs: isRecord(schema.$defs)
      ? Object.keys(schema.$defs)
      : [],
    definitions: isRecord(schema.definitions)
      ? Object.keys(schema.definitions)
      : [],
    rootComposition: compositionKeywords(schema),
    fieldCountShown: flattened.fields.length,
    truncated: flattened.truncated,
    fields: flattened.fields,
  };
}

function metadataIndicators(tool: JsonRecord): string[] {
  const text = [
    stringValue(tool.slug),
    stringValue(tool.name),
    stringValue(tool.description),
  ]
    .filter((value): value is string => value !== null)
    .join(" ");

  const indicators: string[] = [];

  if (/graphql/i.test(text)) indicators.push("GRAPHQL");
  if (/\brest\b|rest api/i.test(text)) indicators.push("REST");
  if (/legacy|deprecated/i.test(text)) indicators.push("LEGACY_OR_DEPRECATED");
  if (/beta|preview/i.test(text)) indicators.push("BETA_OR_PREVIEW");
  if (/helper|convenience|optimized|primary tool/i.test(text)) {
    indicators.push("CONVENIENCE_HELPER");
  }

  return indicators;
}

async function readToolkitTools(
  toolkit: "googlesuper" | "github",
): Promise<JsonRecord[]> {
  const filePath = `data/raw/${toolkit}-tools.json`;
  const snapshot: unknown = await Bun.file(filePath).json();

  if (!isRecord(snapshot) || !Array.isArray(snapshot.tool_list_responses)) {
    throw new Error(`Unexpected raw snapshot structure in ${filePath}`);
  }

  return snapshot.tool_list_responses.flatMap((page) => {
    if (!isRecord(page) || !Array.isArray(page.items)) {
      return [];
    }

    return page.items.filter(isRecord);
  });
}

async function main(): Promise<void> {
  const googleTools = await readToolkitTools("googlesuper");
  const githubTools = await readToolkitTools("github");

  const toolsByToolkit = {
    googlesuper: new Map(
      googleTools.map((tool) => [stringValue(tool.slug), tool]),
    ),
    github: new Map(
      githubTools.map((tool) => [stringValue(tool.slug), tool]),
    ),
  };

  const output: JsonRecord[] = [];

  for (const target of TARGETS) {
    const tool = toolsByToolkit[target.toolkit].get(target.slug);

    if (!tool) {
      output.push({
        toolkit: target.toolkit,
        category: target.category,
        slug: target.slug,
        found: false,
      });

      continue;
    }

    const inputLocation = schemaLocation(
      tool,
      "input_parameters",
      "inputParameters",
    );

    const outputLocation = schemaLocation(
      tool,
      "output_parameters",
      "outputParameters",
    );

    const inputSchema = getSchema(
      tool,
      "input_parameters",
      "inputParameters",
    );

    const outputSchema = getSchema(
      tool,
      "output_parameters",
      "outputParameters",
    );

    output.push({
      toolkit: target.toolkit,
      category: target.category,
      slug: target.slug,
      found: true,
      name: stringValue(tool.name),
      description: stringValue(tool.description),
      version:
        stringValue(tool.version) ??
        stringValue(tool.toolkit_version),
      availableVersions:
        stringArray(
          tool.available_versions ??
          tool.availableVersions,
        ),
      deprecated:
        tool.is_deprecated === true ||
        tool.isDeprecated === true,
      scopes: stringArray(tool.scopes),
      tags: stringArray(tool.tags),
      indicators: metadataIndicators(tool),
      inputSchemaLocation: inputLocation,
      outputSchemaLocation: outputLocation,
      inputSchema: schemaSummary(inputSchema),
      outputSchema: schemaSummary(outputSchema),
    });
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});