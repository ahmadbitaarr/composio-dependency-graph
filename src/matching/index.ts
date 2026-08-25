export {
  candidateId,
  generateDependencyCandidates,
  jsonTypesCompatible,
} from "./candidate-generator";

export {
  createEvaluationContext,
  evaluateDependencyCandidate,
  evaluateDependencyCandidates,
} from "./evaluator";

export {
  buildDecisionArtifacts,
  candidatePairKey,
} from "./artifacts";

export type {
  CandidateEndpoint,
  CandidateGenerationReason,
  DependencyCandidate,
  IndexedField,
} from "./types";

export type {
  CandidateDecision,
  CandidateEvaluation,
  EvaluatedDependencyCandidate,
  EvaluationChecks,
  EvaluationContext,
  EvaluationReason,
  ScopeStatus,
} from "./evaluator";

export type {
  BuiltArtifacts,
  CompactCandidateRecord,
  CompactEndpoint,
  DecisionArtifact,
  GoldFixture,
  GoldFixtureCase,
  GoldValidation,
  ValidationReport,
} from "./artifacts";
