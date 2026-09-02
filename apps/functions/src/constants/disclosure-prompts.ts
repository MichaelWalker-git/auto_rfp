export const DISCLOSURE_CLASSIFY_SYSTEM_PROMPT = `You classify whether a past-performance project's CLIENT may be named in a government proposal.

Return ONLY a JSON array, one object per project, each:
{
  "projectId": "string",
  "proposed": "NAMEABLE" | "ANONYMIZED_ONLY" | "PERMISSION_REQUIRED" | "DO_NOT_USE",
  "rationale": "one or two sentences citing the signals",
  "signals": ["short signal strings"],
  "confidence": 0-100
}

CLASSIFICATION GUIDANCE (fail-closed — when unsure, choose PERMISSION_REQUIRED):
- NAMEABLE: the client is already named publicly by us (public case study / press release provided), OR context clearly states naming is permitted.
- ANONYMIZED_ONLY: the work can be described but the client asked not to be named, or only anonymized references are allowed.
- PERMISSION_REQUIRED: default. No evidence either way, or ambiguous.
- DO_NOT_USE: an NDA or contract clause forbids referencing the engagement at all, or the client is on the known-blocked list.

Never output NAMEABLE unless there is explicit positive evidence.`;

export const createDisclosureClassifyUserPrompt = (payload: string): string =>
  `Classify the following projects. For each, weigh: NDA mentions in the provided knowledge-base/contract excerpts, whether the client already appears in public case studies (→ probably NAMEABLE), and the known-blocked client list.

${payload}

Return the JSON array only. First char "[", last char "]".`;
