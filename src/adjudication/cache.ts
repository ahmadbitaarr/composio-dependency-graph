import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
} from "node:path";

import type {
  AdjudicationDecision,
} from "./schema";

export type AdjudicationCacheIdentity = {
  key: string;
  requestHash: string;
  model: string;
  promptVersion: string;
};

export type AdjudicationCacheRecord = {
  format:
    "adjudication-cache-record-v1";
  key: string;
  requestHash: string;
  candidateId: string;
  model: string;
  promptVersion: string;
  rawResponse: string;
  decision: AdjudicationDecision;
  createdAt: string;
};

export interface AdjudicationCache {
  get(
    key: string,
  ): Promise<
    AdjudicationCacheRecord | null
  >;

  set(
    record:
      AdjudicationCacheRecord,
  ): Promise<void>;
}

type AdjudicationCacheFile = {
  format:
    "adjudication-cache-v1";
  records:
    Record<
      string,
      AdjudicationCacheRecord
    >;
};

function canonicalize(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        canonicalize(item),
    );
  }

  if (
    typeof value === "object" &&
    value !== null
  ) {
    const source =
      value as Record<
        string,
        unknown
      >;

    const result:
      Record<string, unknown> = {};

    for (
      const key
      of Object.keys(source).sort()
    ) {
      if (
        source[key] !== undefined
      ) {
        result[key] =
          canonicalize(
            source[key],
          );
      }
    }

    return result;
  }

  return value;
}

function stableStringify(
  value: unknown,
): string {
  return JSON.stringify(
    canonicalize(value),
  );
}

function sha256(
  value: string,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export function buildAdjudicationCacheIdentity(
  input: {
    candidateId: string;
    candidateContent: unknown;
    prompt: string;
    promptVersion: string;
    model: string;
  },
): AdjudicationCacheIdentity {
  const requestHash =
    sha256(
      stableStringify({
        candidateId:
          input.candidateId,
        candidateContent:
          input.candidateContent,
        prompt: input.prompt,
      }),
    );

  const key =
    sha256(
      stableStringify({
        format:
          "adjudication-cache-key-v1",
        requestHash,
        model: input.model,
        promptVersion:
          input.promptVersion,
      }),
    );

  return {
    key,
    requestHash,
    model: input.model,
    promptVersion:
      input.promptVersion,
  };
}

export class InMemoryAdjudicationCache
implements AdjudicationCache {
  private readonly records =
    new Map<
      string,
      AdjudicationCacheRecord
    >();

  async get(
    key: string,
  ): Promise<
    AdjudicationCacheRecord | null
  > {
    return (
      this.records.get(key) ??
      null
    );
  }

  async set(
    record:
      AdjudicationCacheRecord,
  ): Promise<void> {
    this.records.set(
      record.key,
      record,
    );
  }
}

function errorCode(
  error: unknown,
): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

export class JsonFileAdjudicationCache
implements AdjudicationCache {
  constructor(
    private readonly filePath:
      string,
  ) {}

  private async load():
    Promise<AdjudicationCacheFile> {
    try {
      const content =
        await readFile(
          this.filePath,
          "utf8",
        );

      const parsed =
        JSON.parse(
          content,
        ) as Partial<
          AdjudicationCacheFile
        >;

      if (
        parsed.format !==
          "adjudication-cache-v1" ||
        typeof parsed.records !==
          "object" ||
        parsed.records === null
      ) {
        throw new Error(
          `Invalid adjudication cache file: ${this.filePath}`,
        );
      }

      return {
        format:
          "adjudication-cache-v1",
        records:
          parsed.records,
      };
    } catch (error) {
      if (
        errorCode(error) ===
        "ENOENT"
      ) {
        return {
          format:
            "adjudication-cache-v1",
          records: {},
        };
      }

      throw error;
    }
  }

  private async ensureParent():
    Promise<void> {
    try {
      await mkdir(
        dirname(this.filePath),
        {
          recursive: true,
        },
      );
    } catch (error) {
      if (
        errorCode(error) !==
        "EEXIST"
      ) {
        throw error;
      }
    }
  }

  async get(
    key: string,
  ): Promise<
    AdjudicationCacheRecord | null
  > {
    const file =
      await this.load();

    return (
      file.records[key] ??
      null
    );
  }

  async set(
    record:
      AdjudicationCacheRecord,
  ): Promise<void> {
    const file =
      await this.load();

    file.records[record.key] =
      record;

    await this.ensureParent();

    await writeFile(
      this.filePath,
      JSON.stringify(
        file,
        null,
        2,
      ),
      "utf8",
    );
  }
}