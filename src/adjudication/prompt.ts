import type {
  AdjudicationRequest,
} from "./request-builder";

export function buildAdjudicationPrompt(
  request: AdjudicationRequest,
): string {
  const modelInput = {
    candidateId:
      request.candidateId,
    deterministicAnalysis:
      request.deterministicAnalysis,
    eligibility:
      request.eligibility,
    producer: request.producer,
    consumer: request.consumer,
    evidence: request.evidence,
    allowedEvidenceReferences:
      request
        .allowedEvidenceReferences,
  };

  return [
    "You are adjudicating exactly one proposed tool dependency.",
    "",
    "Use only the supplied evidence. Do not use outside API knowledge, assumptions, memory, or unstated runtime behavior.",
    "",
    "Return exactly one JSON object. Do not include Markdown, code fences, commentary, or additional text.",
    "",
    "Decision rules:",
    "- ACCEPT only when the supplied evidence supports that the producer output can satisfy the consumer input.",
    "- ACCEPT means SUPPORTED, never VERIFIED.",
    "- REJECT when the supplied evidence contradicts the dependency or shows that the value is not usable for this consumer.",
    "- ABSTAIN when the supplied evidence is insufficient, conflicting, or cannot resolve required scope, identity, selection, or transformation.",
    "- A collection may still be ACCEPT when the dependency is supported, but requiresSelection must remain true.",
    "- A resolver may still be ACCEPT when identity lookup is supported, but requiresDisambiguation must remain true.",
    "- A transformation may still be ACCEPT only when the transformation is explicitly supported by the supplied evidence.",
    "- Cite only exact strings from allowedEvidenceReferences.",
    "- Do not treat deterministic reason codes as proof by themselves.",
    "",
    "Required output shape:",
    JSON.stringify(
      {
        candidateId:
          request.candidateId,
        decision:
          "ACCEPT | REJECT | ABSTAIN",
        dependencyKind:
          "LOOKUP | RESOLVER | CREATOR | TRANSFORMATION | UNKNOWN",
        requiresSelection:
          "boolean",
        requiresDisambiguation:
          "boolean",
        requiresTransformation:
          "boolean",
        evidenceReferences: [
          "exact allowed evidence reference",
        ],
        reasonCodes: [
          "UPPER_SNAKE_CASE_REASON",
        ],
        explanation:
          "Concise evidence-based explanation",
      },
      null,
      2,
    ),
    "",
    "Candidate evidence:",
    JSON.stringify(
    {
        candidateId:
        request.candidateId,
        decision:
        "ABSTAIN",
        dependencyKind:
        "UNKNOWN",
        requiresSelection:
        request
            .deterministicAnalysis
            .selectionRequired,
        requiresDisambiguation:
        request
            .deterministicAnalysis
            .disambiguationRequired,
        requiresTransformation:
        request
            .deterministicAnalysis
            .transformationRequired,
        evidenceReferences: [
        request
            .allowedEvidenceReferences[0] ??
            "exact allowed evidence reference",
        ],
        reasonCodes: [
        "INSUFFICIENT_EVIDENCE",
        ],
        explanation:
        "Concise evidence-based explanation.",
    },
    null,
    2,
    ),
  ].join("\n");
}