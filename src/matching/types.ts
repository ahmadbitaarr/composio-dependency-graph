import type {
  NormalizedSchemaField,
  NormalizedTool,
} from "../types";

export type CandidateGenerationReason =
  | "EXACT_CANONICAL_ENTITY"
  | "HARD_SEPARATION_PAIR"
  | "GENERIC_IDENTITY_FIELD"
  | "CONTACT_EMAIL_RECIPIENT_DISAMBIGUATION"
  | "REPOSITORY_FULL_NAME_TRANSFORMATION"
  | "ISSUE_PULL_REQUEST_NUMBER_AMBIGUITY";

export type CandidateEndpoint = {
  toolSlug: string;
  fieldId: string;
  path: string;
  fieldName: string;
  jsonTypes: string[];
  canonicalEntity: string | null;
  canonicalConfidence: string | null;
  safeForInference: boolean;
  arrayDepth: number;
  effectivelyRequired: boolean;
  toolkit: string;
  service: string;
  resourceFamily: string;
  protocol: string;
  apiGeneration: string;
  abstractionLevel: string;
  deprecated: boolean;
  schemaCompleteness: string;
};

export type DependencyCandidate = {
  id: string;
  producer: CandidateEndpoint;
  consumer: CandidateEndpoint;
  generationReasons: CandidateGenerationReason[];
  matchedCanonicalEntity: string | null;
  hardSeparation: {
    left: string;
    right: string;
    reason: string;
  } | null;
};

export type IndexedField = {
  tool: NormalizedTool;
  field: NormalizedSchemaField;
};
