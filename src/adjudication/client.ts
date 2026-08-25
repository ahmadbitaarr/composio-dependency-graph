import {
  buildAdjudicationCacheIdentity,
  type AdjudicationCache,
  type AdjudicationCacheRecord,
} from "./cache";
import {
  buildAdjudicationPrompt,
} from "./prompt";
import type {
  AdjudicationRequest,
} from "./request-builder";
import type {
  AdjudicationValidationResult,
} from "./validate-response";
import {
  validateAdjudicationResponse,
} from "./validate-response";

export type OpenRouterCompletionInput = {
  model: string;
  prompt: string;
  timeoutMs: number;
};

export type OpenRouterCompletion = {
  content: string;
  requestId: string | null;
};

export interface AdjudicationTransport {
  complete(
    input:
      OpenRouterCompletionInput,
  ): Promise<OpenRouterCompletion>;
}

export class OpenRouterTransportError
extends Error {
  readonly retryable: boolean;
  readonly statusCode:
    number | null;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      statusCode?: number | null;
    },
  ) {
    super(message);

    this.name =
      "OpenRouterTransportError";

    this.retryable =
      options.retryable;

    this.statusCode =
      options.statusCode ??
      null;
  }
}

export type AdjudicationExecutionResult =
  | {
      status: "DRY_RUN";
      candidateId: string;
      model: string;
      cacheKey: string;
      requestHash: string;
      attempts: 0;
      llmRequestsMade: false;
    }
  | {
      status: "CACHE_HIT";
      candidateId: string;
      model: string;
      cacheKey: string;
      requestHash: string;
      attempts: 0;
      llmRequestsMade: false;
      record:
        AdjudicationCacheRecord;
    }
  | {
      status: "COMPLETED";
      candidateId: string;
      model: string;
      cacheKey: string;
      requestHash: string;
      attempts: number;
      llmRequestsMade: true;
      record:
        AdjudicationCacheRecord;
    }
  | {
      status: "FAILED";
      candidateId: string;
      model: string;
      cacheKey: string;
      requestHash: string;
      attempts: number;
      llmRequestsMade: boolean;
      failure: {
        code:
          | "TRANSPORT_FAILURE"
          | "INVALID_MODEL_RESPONSE";
        message: string;
        retryable: boolean;
      };
      validation:
        AdjudicationValidationResult
        | null;
    };

export type RunAdjudicationOptions = {
  request: AdjudicationRequest;
  model: string;
  transport:
    AdjudicationTransport;
  cache: AdjudicationCache;
  dryRun?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (
    milliseconds: number,
  ) => Promise<void>;
  now?: () => Date;
};

function retryableHttpStatus(
  status: number,
): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

function errorMessage(
  error: unknown,
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  return String(error);
}

function errorIsRetryable(
  error: unknown,
): boolean {
  if (
    error instanceof
    OpenRouterTransportError
  ) {
    return error.retryable;
  }

  return true;
}

function defaultSleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function extractCompletionContent(
  value: unknown,
): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("choices" in value) ||
    !Array.isArray(value.choices)
  ) {
    throw new OpenRouterTransportError(
      "OpenRouter returned an invalid response envelope.",
      {
        retryable: false,
      },
    );
  }

  const firstChoice =
    value.choices[0];

  if (
    typeof firstChoice !==
      "object" ||
    firstChoice === null ||
    !("message" in firstChoice) ||
    typeof firstChoice.message !==
      "object" ||
    firstChoice.message === null ||
    !("content" in firstChoice.message) ||
    typeof firstChoice
      .message.content !== "string"
  ) {
    throw new OpenRouterTransportError(
      "OpenRouter returned no assistant message content.",
      {
        retryable: false,
      },
    );
  }

  return firstChoice
    .message.content;
}

export function createOpenRouterHttpTransport(
  options: {
    endpoint?: string;
    fetchImplementation?:
      typeof fetch;
  } = {},
): AdjudicationTransport {
  const endpoint =
    options.endpoint ??
    "https://openrouter.ai/api/v1/chat/completions";

  const fetchImplementation =
    options.fetchImplementation ??
    fetch;

  return {
    async complete(
      input:
        OpenRouterCompletionInput,
    ): Promise<OpenRouterCompletion> {
      const apiKey =
        process.env
          .OPENROUTER_API_KEY;

      if (!apiKey) {
        throw new OpenRouterTransportError(
          "OPENROUTER_API_KEY is not configured.",
          {
            retryable: false,
          },
        );
      }

      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          input.timeoutMs,
        );

      try {
        const response =
          await fetchImplementation(
            endpoint,
            {
              method: "POST",
              headers: {
                Authorization:
                  `Bearer ${apiKey}`,
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                model: input.model,
                messages: [
                  {
                    role: "user",
                    content:
                      input.prompt,
                  },
                ],
                temperature: 0,
              }),
              signal:
                controller.signal,
            },
          );

        if (!response.ok) {
          throw new OpenRouterTransportError(
            `OpenRouter returned HTTP ${response.status}.`,
            {
              statusCode:
                response.status,
              retryable:
                retryableHttpStatus(
                  response.status,
                ),
            },
          );
        }

        const envelope:
          unknown =
          await response.json();

        return {
          content:
            extractCompletionContent(
              envelope,
            ),
          requestId:
            response.headers.get(
              "x-request-id",
            ),
        };
      } catch (error) {
        if (
          controller.signal.aborted
        ) {
          throw new OpenRouterTransportError(
            "OpenRouter request timed out.",
            {
              retryable: true,
            },
          );
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function runAdjudication(
  options:
    RunAdjudicationOptions,
): Promise<
  AdjudicationExecutionResult
> {
  const model =
    options.model.trim();

  if (!model) {
    throw new Error(
      "An explicit OpenRouter model ID is required.",
    );
  }

  const timeoutMs =
    options.timeoutMs ??
    30_000;

  const maxAttempts =
    options.maxAttempts ?? 2;

  const retryDelayMs =
    options.retryDelayMs ??
    250;

  if (
    !Number.isInteger(
      maxAttempts,
    ) ||
    maxAttempts < 1
  ) {
    throw new Error(
      "maxAttempts must be a positive integer.",
    );
  }

  if (
    !Number.isFinite(
      timeoutMs,
    ) ||
    timeoutMs <= 0
  ) {
    throw new Error(
      "timeoutMs must be positive.",
    );
  }

  const prompt =
    buildAdjudicationPrompt(
      options.request,
    );

  const identity =
    buildAdjudicationCacheIdentity({
      candidateId:
        options.request
          .candidateId,
      candidateContent:
        options.request,
      prompt,
      promptVersion:
        options.request
          .promptVersion,
      model,
    });

  if (options.dryRun) {
    return {
      status: "DRY_RUN",
      candidateId:
        options.request
          .candidateId,
      model,
      cacheKey:
        identity.key,
      requestHash:
        identity.requestHash,
      attempts: 0,
      llmRequestsMade: false,
    };
  }

  const cached =
    await options.cache.get(
      identity.key,
    );

  if (cached) {
    return {
      status: "CACHE_HIT",
      candidateId:
        options.request
          .candidateId,
      model,
      cacheKey:
        identity.key,
      requestHash:
        identity.requestHash,
      attempts: 0,
      llmRequestsMade: false,
      record: cached,
    };
  }

  const sleep =
    options.sleep ??
    defaultSleep;

  const now =
    options.now ??
    (() => new Date());

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      const completion =
        await options
          .transport
          .complete({
            model,
            prompt,
            timeoutMs,
          });

      const validation =
        validateAdjudicationResponse(
          completion.content,
          options.request,
        );

      if (!validation.valid) {
        return {
          status: "FAILED",
          candidateId:
            options.request
              .candidateId,
          model,
          cacheKey:
            identity.key,
          requestHash:
            identity.requestHash,
          attempts: attempt,
          llmRequestsMade: true,
          failure: {
            code:
              "INVALID_MODEL_RESPONSE",
            message:
              "The model response failed adjudication validation.",
            retryable: false,
          },
          validation,
        };
      }

      const record:
        AdjudicationCacheRecord = {
          format:
            "adjudication-cache-record-v1",
          key: identity.key,
          requestHash:
            identity.requestHash,
          candidateId:
            options.request
              .candidateId,
          model,
          promptVersion:
            options.request
              .promptVersion,
          rawResponse:
            completion.content,
          decision:
            validation.decision,
          createdAt:
            now().toISOString(),
        };

      await options.cache.set(
        record,
      );

      return {
        status: "COMPLETED",
        candidateId:
          options.request
            .candidateId,
        model,
        cacheKey:
          identity.key,
        requestHash:
          identity.requestHash,
        attempts: attempt,
        llmRequestsMade: true,
        record,
      };
    } catch (error) {
      const retryable =
        errorIsRetryable(error);

      if (
        retryable &&
        attempt < maxAttempts
      ) {
        await sleep(
          retryDelayMs *
            attempt,
        );

        continue;
      }

      return {
        status: "FAILED",
        candidateId:
          options.request
            .candidateId,
        model,
        cacheKey:
          identity.key,
        requestHash:
          identity.requestHash,
        attempts: attempt,
        llmRequestsMade: true,
        failure: {
          code:
            "TRANSPORT_FAILURE",
          message:
            errorMessage(error),
          retryable,
        },
        validation: null,
      };
    }
  }

  throw new Error(
    "Adjudication execution reached an unreachable state.",
  );
}