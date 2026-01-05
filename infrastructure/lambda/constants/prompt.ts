import { readSystemPrompt, readUserPrompt } from '../helpers/propmt';
import { RoleSchema } from '@auto-rfp/shared';

export const SYSTEM_PROMPT_PK = 'SYSTEM_PROMPT';
export const USER_PROMPT_PK = 'USER_PROMPT';

export const PROPOSAL_SYSTEM_PROMPT = `
You are a proposal writer for US government and commercial RFPs.

Return ONLY valid JSON with this structure:

{
  "proposalTitle": string,
  "customerName"?: string,
  "opportunityId"?: string,
  "outlineSummary"?: string,
  "sections": [
    {
      "id": string,
      "title": string,
      "summary"?: string,
      "subsections": [
        { "id": string, "title": string, "content": string }
      ]
    }
  ]
}

Rules:
- Use information from Q&A and knowledge base snippets wherever relevant.
- If unknown, use generic language. Do NOT invent specific numbers, dates, IDs.
- Do NOT include any text outside JSON.
`.trim();

export const PROPOSAL_USER_PROMPT = `
RFP Metadata:
{{SOLICITATION}}
Q&A:
{{QA_TEXT}}

Knowledge Base Snippets:
{{KB_TEXT}}

Task:
1) Create an outline tailored to this opportunity and customer.
2) Write all sections/subsections as full proposal text.
3) Return ONLY JSON in the required format.
`.trim();

export const getProposalSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'PROPOSAL') || {};
  return prompt ? prompt : PROPOSAL_SYSTEM_PROMPT;
};

export const useProposalSystemPrompt = async (orgId: string) => {
  return await getProposalSystemPrompt(orgId);
};

export const getProposalUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'PROPOSAL') || {};
  return prompt ? prompt : PROPOSAL_USER_PROMPT;
};

export const useProposalUserPrompt = async (
  orgId: string,
  solicitation?: string,
  qaText?: string,
  kbText?: string
): Promise<string | undefined> => {
  const prompt = await getProposalUserPrompt(orgId);
  return prompt && prompt
    .replace('{{QA_TEXT}}', qaText ?? 'None')
    .replace('{{KB_TEXT}}', kbText ?? 'None')
    .replace('{{SOLICITATION}}', solicitation ?? 'None');
};


export const SUMMARY_SYSTEM_PROMPT = [
  'You are an expert government contracting capture analyst.',
  'Return ONLY valid JSON that matches the provided schema.',
  'Do not include markdown, code fences, commentary, or extra keys.',
  'If a value is unknown, omit the optional field; do not guess.',
  'Prefer extracting exact strings/numbers from the solicitation text.',
].join('\n');

export const SUMMARY_USER_PROMPT = [
  'TASK: Extract a "Quick Summary" for an Executive Opportunity Brief.',
  '',
  'OUTPUT JSON SCHEMA (must match exactly):',
  '{{SUMMARY_SCHEMA}}',
  '',
  'RULES:',
  '- title, agency, and summary are required.',
  '- naics should be numeric (2-6 digits) if present.',
  '- estimatedValueUsd should be a NUMBER (no commas). If range, omit.',
  '- setAside and contractType must use allowed enum values; if unclear, use "UNKNOWN".',
  '- Include evidence[] with short snippets for key fields when possible.',
  '',
  'COMPANY CONTEXT (knowledge base excerpts; may be empty):',
  '{{KB_TEXT}}',
  '',
  'SOLICITATION TEXT:',
  '{{SOLICITATION}}',
].join('\n');

export const getSummarySystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'SUMMARY') || {};
  return prompt ? prompt : SUMMARY_SYSTEM_PROMPT;
};

export const getSummaryUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'SUMMARY') || {};
  return prompt ? prompt : SUMMARY_USER_PROMPT;
};

export const useSummaryUserPrompt = async (
  orgId: string,
  solicitation: string,
  kbText: string,
  summarySchema: string
) => {
  const prompt = await getSummaryUserPrompt(orgId);
  return prompt
    .replace('{{SUMMARY_SCHEMA}}', summarySchema ?? 'None')
    .replace('{{KB_TEXT}}', kbText ?? 'None')
    .replace('{{SOLICITATION}}', solicitation ?? 'None');
};


export const CONTACTS_SYSTEM_PROMPT = [
  'You extract contact information from government solicitations.',
  'Return ONLY valid JSON matching the schema. No markdown, no code fences, no extra keys.',
  'Do not invent names/emails/phones.',
  'If role is unclear, use OTHER and include notes.',
  'Extract multiple contacts if present.',
].join('\n');

export const CONTACTS_USER_PROMPT = [
  'TASK: Build a contact directory for an Executive Opportunity Brief.',
  '',
  'You must extract contacts with differentiated roles, such as:',
  '- Contracting Officer',
  '- Contract Specialist',
  '- Technical POC',
  '- Program Manager',
  '- Small Business Specialist',
  '- Procurement POC',
  '- Subcontracting POC',
  '- General Inquiry',
  '',
  'OUTPUT JSON MUST match this schema:',
  '- contacts: array of { role, name?, title?, email?, phone?, organization?, notes?, evidence[] }',
  '- missingRecommendedRoles: array of role enums that were not found',
  '',
  'Allowed roles enum values:',
  JSON.stringify(RoleSchema.options, null, 2),
  '',
  'RULES:',
  '- If no email/phone is present, still include the contact name/title/role if available.',
  '- evidence[] should include SOLICITATION snippets around the contact line when possible.',
  'EVIDENCE FORMAT (IMPORTANT):',
  '- evidence must be an array of OBJECTS, not strings.',
  '- Each evidence item must be: { source: SOLICITATION, text: <>}',
  '- If you cannot provide evidence, set evidence to an empty array [].',
  '',
  'SOLICITATION TEXT:',
  '{{SOLICITATION}}',
].join('\n');

export const useContactsSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'CONTACTS') || {};
  return prompt || CONTACTS_SYSTEM_PROMPT;
};

export const getContactsUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'CONTACTS') || {};
  return prompt || CONTACTS_USER_PROMPT;
};

export const useContactsUserPrompt = async (orgId: string, solicitation: string) => {
  const prompt = await getContactsUserPrompt(orgId);
  return prompt && prompt.replace('{{SOLICITATION}}', solicitation);
};

export const REQUIREMENTS_SYSTEM_PROMPT = [
  'You summarize requirements from government solicitations for bid/no-bid decisions.',
  '',
  'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
  '- Output ONLY a single valid JSON object.',
  '- Do NOT output any text before "{" or after "}".',
  '- No prose, no markdown, no code fences, no commentary.',
  '- The first character of your response MUST be "{" and the last character MUST be "}".',
  '- The JSON must match the RequirementsSection schema exactly. Do NOT add extra keys.',
  '',
  'SCHEMA CONSTRAINTS:',
  '- overview: string (min 10 chars).',
  '- requirements: array with at least 1 item.',
  '- Each requirement item: { category?: string, requirement: string (min 5), mustHave: boolean, evidence: EvidenceRef[] }',
  '- deliverables: string[] (can be empty).',
  '- evaluationFactors: string[] (can be empty).',
  '- submissionCompliance: { format: string[], requiredVolumes: string[], attachmentsAndForms: string[] }',
  '',
  'EVIDENCE FORMAT (IMPORTANT):',
  '- evidence is an array of objects (NOT strings).',
  '- EvidenceRef object keys you may use: source, snippet, chunkKey, documentId.',
  '- Use "snippet" for short quotes.',
  '- If no evidence, use an empty array [].',
  '',
  'CONTENT RULES:',
  '- Do not invent requirements. If unclear, omit or use category "OTHER".',
  '- Prefer concise requirement strings (short, imperative).',
  '- Focus on: technical requirements, deliverables, compliance/submission rules, evaluation factors.',
].join('\n');

export const REQUIREMENTS_USER_PROMPT = [
  'TASK: Build a detailed requirements summary for an Executive Opportunity Brief.',
  '',
  'IMPORTANT:',
  '- Return JSON ONLY.',
  '- First character MUST be "{" and last character MUST be "}".',
  '',
  'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
  '{',
  '  "overview": "string (min 10 chars)",',
  '  "requirements": [',
  '    {',
  '      "category": "TECHNICAL",',
  '      "requirement": "string (min 5 chars)",',
  '      "mustHave": true,',
  '      "evidence": [',
  '        { "source": "SOLICITATION", "snippet": "short quote" }',
  '      ]',
  '    }',
  '  ],',
  '  "deliverables": [],',
  '  "evaluationFactors": [],',
  '  "submissionCompliance": {',
  '    "format": [],',
  '    "requiredVolumes": [],',
  '    "attachmentsAndForms": []',
  '  }',
  '}',
  '',
  'REQUIRED CONTENT:',
  '- A short overview of what is being procured and what success looks like.',
  '- Requirements categorized (TECHNICAL / SECURITY / COMPLIANCE / DELIVERABLES / STAFFING / OTHER).',
  '- Deliverables list (if explicit).',
  '- Evaluation factors list (if explicit).',
  '- Submission compliance rules: page limits, formatting, required volumes, attachments/forms, portals, file naming.',
  '',
  'RULES:',
  '- "mustHave" should be true if the solicitation makes it mandatory.',
  '- evidence[] must be objects with "snippet" (not strings). Use [] if no quote.',
  '- Do not add company marketing; only summarize the solicitation.',
  '',
  'COMPANY CONTEXT (KB excerpts; may be empty):',
  '{{KB_TEXT}}',
  '',
  'SOLICITATION TEXT:',
  '{{SOLICITATION}}',
].join('\n');

export const useRequirementsSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'REQUIREMENTS') || {};
  return prompt || REQUIREMENTS_SYSTEM_PROMPT;
};

export const getRequirementsUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'REQUIREMENTS') || {};
  return prompt || REQUIREMENTS_USER_PROMPT;
};

export const useRequirementsUserPrompt = async (orgId: string, solicitation?: string, kbText?: string) => {
  const prompt = await getRequirementsUserPrompt(orgId);
  return prompt && prompt
    .replace('{{SOLICITATION}}', solicitation ?? 'None')
    .replace('{{KB_TEXT}}', kbText ?? 'None');
};

export const RISK_SYSTEM_PROMPT = [
  'You are a government contracting capture and compliance analyst.',
  'Identify risks and red flags for a bid/no-bid decision.',
  '',
  'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
  '- Output ONLY a single valid JSON object.',
  '- Do NOT output any text before "{" or after "}".',
  '- No prose, no markdown, no code fences.',
  '- The first character MUST be "{" and the last character MUST be "}".',
  '- JSON must match the RisksSection schema exactly. Do NOT add extra keys.',
  '',
  'EVIDENCE FORMAT (IMPORTANT):',
  '- evidence MUST be an array of objects (NOT strings).',
  '- EvidenceRef object keys allowed: source, snippet, chunkKey, documentId.',
  '- Use "snippet" for short quotes from the solicitation.',
  '- If you cannot cite evidence for an item, DO NOT include the item (omit it).',
  '',
  'CONTENT RULES:',
  '- Do not invent facts.',
  '- If uncertain, phrase as "potential risk" and include evidence.',
  '- Prefer specific, actionable mitigations.',
  '- severity must be one of LOW, MEDIUM, HIGH, CRITICAL.',
  '- impactsScore should be true for HIGH/CRITICAL unless clearly not impacting score.',
].join('\n');

export const RISK_USER_PROMPT = [
  'TASK: Produce a risk assessment for an Executive Opportunity Brief.',
  '',
  'Return JSON ONLY. First char "{" last char "}".',
  '',
  'OUTPUT JSON must match the RisksSection schema exactly, with keys:',
  '- risks: RiskFlag[]',
  '- redFlags: RiskFlag[]',
  '- incumbentInfo: { knownIncumbent, incumbentName?, recompete, notes?, evidence[] }',
  '',
  'RiskFlag schema (conceptual):',
  '{ "severity": "LOW|MEDIUM|HIGH|CRITICAL", "flag": "...", "whyItMatters"?: "...", "mitigation"?: "...", "impactsScore": true|false, "evidence": EvidenceRef[] }',
  '',
  'EvidenceRef MUST be objects (NOT strings):',
  '{ "source": "SOLICITATION", "snippet": "short quote" }',
  '',
  'INCLUDE ITEMS FOR (examples):',
  '- Very short response window / unrealistic schedule',
  '- Mandatory site visits or orals with tight dates',
  '- Strong incumbent advantage / recompete indicators / brand-name language',
  '- Excessive compliance burden (many attachments, strict page limits, unique formats)',
  '- Security clearances, certifications, facility requirements (potential blockers)',
  '- Harsh terms (liquidated damages, extreme SLAs, unusual insurance)',
  '',
  'RULES:',
  '- Do not invent risks.',
  '- If no evidence for an item, omit it (do not include it with empty evidence).',
  '- Keep flags short and specific; mitigations actionable.',
  '',
  'SOLICITATION TEXT:',
  '{{SOLICITATION}}',
].join('\n');

export const getRiskSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'RISK') || {};
  return prompt || RISK_SYSTEM_PROMPT;
};

export const useRiskSystemPrompt = async (orgId: string) => {
  return await getRiskSystemPrompt(orgId);
};

export const getRiskUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'RISK') || {};
  return prompt || RISK_USER_PROMPT;
};

export const useRiskUserPrompt = async (orgId: string, solicitation?: string) => {
  const prompt = await getRiskUserPrompt(orgId);
  return prompt.replace('{{SOLICITATION}}', solicitation || 'None');
};
