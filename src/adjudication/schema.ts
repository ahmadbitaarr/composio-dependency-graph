import { z } from "zod";

export const AdjudicationDecisionSchema =
  z
    .object({
      candidateId: z.string().min(1),
      decision: z.enum([
        "ACCEPT",
        "REJECT",
        "ABSTAIN",
      ]),
      dependencyKind: z.enum([
        "LOOKUP",
        "RESOLVER",
        "CREATOR",
        "TRANSFORMATION",
        "UNKNOWN",
      ]),
      requiresSelection: z.boolean(),
      requiresDisambiguation: z.boolean(),
      requiresTransformation: z.boolean(),
      evidenceReferences: z
        .array(z.string().min(1))
        .min(1)
        .max(64),
      reasonCodes: z
        .array(z.string().min(1))
        .min(1)
        .max(32),
      explanation: z
        .string()
        .min(1)
        .max(2000),
    })
    .strict();

export type AdjudicationDecision =
  z.infer<
    typeof AdjudicationDecisionSchema
  >;

export function parseAdjudicationDecision(
  value: unknown,
): AdjudicationDecision {
  return AdjudicationDecisionSchema.parse(
    value,
  );
}