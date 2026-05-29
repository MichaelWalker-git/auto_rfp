import { readSystemPrompt, readUserPrompt } from '../helpers/prompt';
import { RoleSchema } from '@auto-rfp/core';

export const SYSTEM_PROMPT_PK = 'SYSTEM_PROMPT';
export const USER_PROMPT_PK = 'USER_PROMPT';

export const RFP_DOCUMENT_SYSTEM_PROMPT = `
You are a senior proposal writer for US government and commercial RFPs.

Return ONLY valid JSON with this structure:

{
  "title": string,
  "customerName"?: string,
  "opportunityId"?: string,
  "outlineSummary"?: string,
  "htmlContent": string  (complete styled HTML document body — no <html>/<head>/<body> tags)
}

HTML REQUIREMENTS for "htmlContent":
- Use <h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em"> for document title
- Use <h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:0.2em"> for major sections
- Use <h3 style="font-size:1.1em;font-weight:600;margin:1.2em 0 0.4em;color:#374151"> for subsections
- Use <p style="margin:0 0 1em;line-height:1.7;color:#374151"> for body text
- Use <ul style="margin:0 0 1em;padding-left:1.5em"> with <li style="margin-bottom:0.4em;line-height:1.6;color:#374151"> for lists
- Use <div style="background:#eff6ff;border-left:4px solid #4f46e5;padding:1em 1.2em;margin:1em 0;border-radius:0 6px 6px 0"> for callout boxes

Rules:
- Use information from Q&A and knowledge base snippets wherever relevant.
- If unknown, use generic language. Do NOT invent specific numbers, dates, IDs.
- Do NOT include any text outside JSON.
- Generate COMPLETE, DETAILED content — not placeholders.
`.trim();

/** @deprecated Use RFP_DOCUMENT_SYSTEM_PROMPT */
export const PROPOSAL_SYSTEM_PROMPT = RFP_DOCUMENT_SYSTEM_PROMPT;

export const RFP_DOCUMENT_USER_PROMPT = `
═══════════════════════════════════════
SOLICITATION / RFP DOCUMENTS
═══════════════════════════════════════
The following is the full text of the solicitation document(s). This is your PRIMARY source of requirements.
Carefully identify ALL requirements, evaluation criteria (Section M), and submission instructions (Section L).

{{SOLICITATION}}

═══════════════════════════════════════
QUESTIONS & ANSWERS
═══════════════════════════════════════
These are previously answered questions about this opportunity. Use these answers as authoritative content for your document sections. Each Q&A pair represents validated information about the company's approach.

{{QA_TEXT}}

═══════════════════════════════════════
ENRICHMENT CONTEXT (Knowledge Base, Past Performance, Executive Brief, Content Library)
═══════════════════════════════════════
The following context has been gathered from multiple sources. Use it to enrich your document with:
- Company-specific capabilities and processes (Knowledge Base)
- Relevant past contract performance and results (Past Performance)
- Pre-analyzed opportunity intelligence including risks, requirements, and scoring (Executive Brief)
- Pre-approved content snippets for consistent messaging (Content Library)

{{KB_TEXT}}

═══════════════════════════════════════
YOUR TASK
═══════════════════════════════════════
1. ANALYZE the solicitation to identify ALL requirements, evaluation criteria, and submission instructions.
2. DEVELOP 2-3 win themes (key differentiators) based on the company's strengths from the context provided.
3. WRITE a comprehensive document with sections that map to the solicitation's requirements and evaluation criteria.
4. WRITE each section with substantial, detailed content (3-6 paragraphs per section, 150-400 words each).
5. ENSURE every requirement from the solicitation is addressed somewhere in the document.
6. SUPPORT claims with evidence from past performance, knowledge base, and content library.
7. MAINTAIN customer focus throughout — write from the customer's perspective.
8. Return ONLY valid JSON in the required format. No text outside the JSON object.
`.trim();

/** @deprecated Use RFP_DOCUMENT_USER_PROMPT */
export const PROPOSAL_USER_PROMPT = RFP_DOCUMENT_USER_PROMPT;

export const getRfpDocumentSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'RFP_DOCUMENT') || {};
  // Fall back to legacy PROPOSAL key for backwards compatibility
  if (!prompt) {
    const { prompt: legacyPrompt } = await readSystemPrompt(orgId, 'PROPOSAL') || {};
    return legacyPrompt || RFP_DOCUMENT_SYSTEM_PROMPT;
  }
  return prompt;
};

/** @deprecated Use getRfpDocumentSystemPrompt */
export const getProposalSystemPrompt = getRfpDocumentSystemPrompt;
export const useProposalSystemPrompt = async (orgId: string) => getRfpDocumentSystemPrompt(orgId);

export const getRfpDocumentUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'RFP_DOCUMENT') || {};
  if (!prompt) {
    const { prompt: legacyPrompt } = await readUserPrompt(orgId, 'PROPOSAL') || {};
    return legacyPrompt || RFP_DOCUMENT_USER_PROMPT;
  }
  return prompt;
};

/** @deprecated Use getRfpDocumentUserPrompt */
export const getProposalUserPrompt = getRfpDocumentUserPrompt;

export const useProposalUserPrompt = async (
  orgId: string,
  solicitation?: string,
  qaText?: string,
  kbText?: string
): Promise<string | undefined> => {
  const prompt = await getRfpDocumentUserPrompt(orgId);
  return prompt
    .replace('{{QA_TEXT}}', qaText ?? 'None')
    .replace('{{KB_TEXT}}', kbText ?? 'None')
    .replace('{{SOLICITATION}}', solicitation ?? 'None');
};


export const SUMMARY_SYSTEM_PROMPT = [
  'You are an expert government contracting opportunity analyst.',
  '',
  'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
  '- Output ONLY a single valid JSON object.',
  '- Do NOT output any text before "{" or after "}".',
  '- No prose, no markdown, no code fences, no commentary.',
  '- The first character of your response MUST be "{" and the last character MUST be "}".',
  '- JSON must match the SummarySection schema exactly. Do NOT add extra keys.',
  '',
  'CORE REQUIREMENTS:',
  '- title (required): Official RFP/solicitation title or announcement name.',
  '- agency (required): Federal agency or organization issuing the solicitation.',
  '- summary (required): 2-3 sentence overview of what is being procured and why it matters.',
  '- rfpNumber (optional): RFP/IFB number if present (exact string from solicitation).',
  '- contractType (optional): Type of contract (FIXED_PRICE, COST_PLUS, T&M, INDEFINITE_DELIVERY, etc.) - use UNKNOWN if unclear.',
  '- setAside (optional): Small business set-aside category (SMALL_BUSINESS, WOMEN_OWNED, VETERAN_OWNED, DISADVANTAGED, NONE, etc.) - use UNKNOWN if not mentioned.',
  '- naics (optional): NAICS code(s) as string (e.g., "334511" or "541611,541612").',
  '- estimatedValueUsd (optional): Contract value as a STRING (e.g. "$1.5M", "$500,000", "Up to $2M"). Include the original text as-is from the solicitation.',
  '- placeOfPerformance (optional): Location/region where work will be performed.',
  '- evidence (optional): Array of objects with source and snippet; used for key claims.',
  '',
  'EVIDENCE FORMAT (IMPORTANT):',
  '- evidence MUST be an array of objects (NOT strings).',
  '- Each object: { source: "SOLICITATION", snippet: "short quote from text" }',
  '- Only include evidence for key fields (title, agency, value, type, set-aside).',
  '- If no evidence available, use empty array [].',
  '',
  'NON-HALLUCINATION RULES:',
  '- Do NOT invent or guess RFP numbers, dates, contract values, or agency names.',
  '- If a field is uncertain or not present, OMIT it (do not add with null/unknown).',
  '- Extract ONLY exact strings from the solicitation.',
].join('\n');

export const SUMMARY_USER_PROMPT = [
  'TASK: Extract an Executive Opportunity Summary from this solicitation.',
  '',
  'Return JSON ONLY. First char "{" last char "}".',
  '',
  'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
  '{',
  '  "title": "string (required)",',
  '  "agency": "string (required)",',
  '  "summary": "string (required, 2-3 sentences)",',
  '  "rfpNumber": "string (optional, exact from solicitation)",',
  '  "contractType": "string (optional, use UNKNOWN if unclear)",',
  '  "setAside": "string (optional, use UNKNOWN if not mentioned)",',
  '  "naics": "string (optional, numeric codes)",',
  '  "estimatedValueUsd": "$1,000,000",',
  '  "placeOfPerformance": "string (optional)",',
  '  "evidence": [',
  '    { "source": "SOLICITATION", "snippet": "short quote" }',
  '  ]',
  '}',
  '',
  'EXTRACTION GUIDANCE:',
  '',
  'TITLE:',
  '- Use the official solicitation title/announcement headline.',
  '- If multiple titles present, use the formal RFP/IFB title.',
  '- Example: "Software Development Services for Healthcare Portal"',
  '',
  'AGENCY:',
  '- Extract the issuing federal agency (e.g., "Department of Defense", "GSA", "FDA").',
  '- If sub-agency mentioned, include it (e.g., "Army Corps of Engineers").',
  '',
  'SUMMARY:',
  '- Write 2-3 sentences explaining WHAT is being procured and WHY it matters.',
  '- Focus on business objective, not just technical specs.',
  '- Example: "Solicitation for enterprise cloud migration services. Contractor must move 50+ applications from on-premise to AWS. 18-month program supporting DoD digital transformation."',
  '',
  'RFC/RFP/IFB NUMBER:',
  '- Extract the official solicitation number (e.g., "FA8103-24-R-0001", "66-0001-2024-A").',
  '- If not clearly present, omit this field.',
  '',
  'CONTRACT TYPE:',
  '- Use one of: FIXED_PRICE, COST_PLUS, TIME_AND_MATERIALS, INDEFINITE_DELIVERY, TASK_ORDER, BLANKET_PURCHASE_AGREEMENT, OTHER.',
  '- If multiple types mentioned, use the primary one.',
  '- If unclear or not stated, omit (do not use UNKNOWN).',
  '',
  'SET-ASIDE CATEGORY:',
  '- Use one of: SMALL_BUSINESS, WOMEN_OWNED, VETERAN_OWNED, DISADVANTAGED, SERVICE_DISABLED_VETERAN, HUBZONE, NONE.',
  '- NONE = explicitly NOT a set-aside.',
  '- If no set-aside mentioned, omit (do not use UNKNOWN).',
  '',
  'NAICS:',
  '- Extract NAICS code(s) if provided (6-digit numeric codes).',
  '- If multiple, use comma-separated list (e.g., "541611,541620").',
  '- If not present, omit.',
  '',
  'ESTIMATED VALUE:',
  '- Use a STRING with the original value text from the solicitation (e.g., "$1,500,000", "$1.5M", "Up to $2M", "$1M-$2M").',
  '- Do NOT convert to a number. Preserve the original format including $ signs, commas, and ranges.',
  '- If unclear or not stated, omit.',
  '',
  'PLACE OF PERFORMANCE:',
  '- City, state, or region where work will be performed.',
  '- Example: "Washington, DC" or "Multiple locations across CONUS".',
  '- If not specified, omit.',
  '',
  'EVIDENCE:',
  '- For title, agency, RFP number, contract value, and set-aside: include a snippet.',
  '- Evidence must be direct quotes from the solicitation.',
  '- Format: { "source": "SOLICITATION", "snippet": "..." }',
  '- If you cannot find a direct quote, omit the evidence for that field.',
  '',
  'IMPORTANT:',
  '- Do NOT invent RFP numbers, values, or agency names.',
  '- If information is not in the solicitation, OMIT the field.',
  '- evidence[] must be objects (NOT strings). Use [] if no evidence.',
  '- Keep summary concise and focused on opportunity scope, not boilerplate.',
  '',
  'COMPANY CONTEXT (knowledge base; may be empty):',
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


export const DEADLINE_SYSTEM_PROMPT = [
  'You extract deadlines from government solicitations.',
  '',
  'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
  '- Output ONLY a single valid JSON object. No prose, no markdown, no code fences.',
  '- The first character MUST be "{" and the last character MUST be "}".',
  '- JSON must match the DeadlinesSection schema exactly. Do NOT add extra keys.',
  '',
  'CRITICAL VALIDATION RULES:',
  '- dateTimeIso and submissionDeadlineIso MUST be ISO-8601 datetime strings if present.',
  '- Valid examples: "2026-01-15T17:00:00Z" or "2026-01-15T17:00:00-05:00".',
  '- If you cannot confidently produce a valid ISO datetime, OMIT dateTimeIso/submissionDeadlineIso and use rawText + notes.',
  '',
  'EVIDENCE RULES:',
  '- evidence MUST be an array of objects, not strings.',
  '- EvidenceRef object keys allowed: source, snippet, chunkKey, documentId.',
  '- Use snippet for short quotes from the solicitation. If unknown, use [].',
  '',
  'CONTENT RULES:',
  '- Do not invent deadlines.',
  '- Extract ALL deadlines mentioned (not just proposal due).',
  '- If multiple dates/times exist, include multiple deadline entries.',
].join('\n');

export const getDeadlineSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'DEADLINE') || {};
  return prompt || DEADLINE_SYSTEM_PROMPT;
};

export const useDeadlineSystemPrompt = async (orgId: string, _solicitation?: string) => {
  return await getDeadlineSystemPrompt(orgId);
};

export const DEADLINE_USER_PROMPT = [
  'TASK: Extract ALL deadlines from this solicitation.',
  '',
  'Return JSON ONLY. First char "{" last char "}".',
  '',
  'Use these deadline type values (prefer these exact words):',
  '- PROPOSAL_DUE',
  '- QUESTIONS_DUE',
  '- SITE_VISIT',
  '- PRE_PROPOSAL_CONFERENCE',
  '- AMENDMENT_CUTOFF',
  '- ORALS',
  '- AWARD_ESTIMATE',
  '- OTHER',
  '',
  'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
  '{',
  '  "deadlines": [',
  '    {',
  '      "type": "PROPOSAL_DUE",',
  '      "label": "Proposal submission deadline",',
  '      "dateTimeIso": "2026-01-15T17:00:00Z",',
  '      "rawText": "optional original text",',
  '      "timezone": "ET",',
  '      "notes": "optional",',
  '      "evidence": [ { "source": "SOLICITATION", "snippet": "short quote" } ]',
  '    }',
  '  ],',
  '  "hasSubmissionDeadline": true,',
  '  "submissionDeadlineIso": "2026-01-15T17:00:00Z",',
  '  "warnings": []',
  '}',
  '',
  'IMPORTANT:',
  '- If you are NOT 100% sure of the ISO datetime, OMIT dateTimeIso and use rawText + notes instead.',
  '- If timezone is not explicit, omit timezone and add a warning like "No explicit timezone found".',
  '- If you found a deadline in text but could not parse a datetime, set notes to "UNPARSED_DATE" and include rawText.',
  '- evidence[] must be objects with "snippet" (NOT strings). Use [] if you cannot quote.',
  '',
  'SOLICITATION TEXT:',
  '{{SOLICITATION}}',
].join('\n');


export const getDeadlineUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'DEADLINE') || {};
  return prompt || DEADLINE_USER_PROMPT;
};

export const useDeadlineUserPrompt = async (orgId: string, solicitation?: string) => {
  const prompt = await getDeadlineUserPrompt(orgId);
  return prompt.replace('{{SOLICITATION}}', solicitation || 'None');
};

export const SCORING_SYSTEM_PROMPT = [
  'You are a senior capture director making a bid/no-bid decision.',
  '',
  'STRICT OUTPUT CONTRACT (MUST FOLLOW):',
  '- Output ONLY a single valid JSON object.',
  '- Do NOT output any text before "{" or after "}".',
  '- No prose, no markdown, no code fences.',
  '- The first character MUST be "{" and the last character MUST be "}".',
  '- JSON must match the ScoringSection schema exactly. Do NOT add extra keys.',
  '',
  'SCORING FRAMEWORK (5 Dimensions with Weights):',
  '1. TECHNICAL_FIT (20% weight): Can we do the work? Alignment with our capabilities.',
  '2. PAST_PERFORMANCE_RELEVANCE (25% weight): Do we have relevant past performance? This is often 30-40% of evaluation score.',
  '3. PRICING_POSITION (15% weight): Can we price competitively while maintaining margin?',
  '4. STRATEGIC_ALIGNMENT (25% weight): Does this opportunity align with our strategic goals and build our portfolio?',
  '5. INCUMBENT_RISK (15% weight): What is the incumbent advantage? Is this a recompete?',
  '',
  'SCORING RULES:',
  '- You MUST output exactly 5 criteria entries with names: TECHNICAL_FIT, PAST_PERFORMANCE_RELEVANCE, PRICING_POSITION, STRATEGIC_ALIGNMENT, INCUMBENT_RISK.',
  '- Each score must be an integer 1..5:',
  '  5 = Excellent fit / no concerns',
  '  4 = Good / minor gaps',
  '  3 = Acceptable / moderate gaps',
  '  2 = Marginal / significant concerns',
  '  1 = Poor fit / critical gaps',
  '- rationale must be at least 20 characters.',
  '- compositeScore = (TECHNICAL_FIT*0.20 + PAST_PERFORMANCE_RELEVANCE*0.25 + PRICING_POSITION*0.15 + STRATEGIC_ALIGNMENT*0.25 + INCUMBENT_RISK*0.15)',
  '- decision rules:',
  '  - compositeScore >= 4.0 → GO (pursue aggressively)',
  '  - 3.0-3.99 → GO or CONDITIONAL_GO (manageable with actions)',
  '  - 2.0-2.99 → CONDITIONAL_GO (significant concerns, list blockers)',
  '  - <2.0 → NO_GO (major issues)',
  '- If scoring < 3.0, decision should be CONDITIONAL_GO or NO_GO with blockers listed.',
  '- requiredActions should list mandatory steps before bidding.',
  '',
  'PAST PERFORMANCE RELEVANCE SCORING (CRITICAL - often 30-40% of evaluation):',
  '- 5: Multiple highly relevant past projects (>90% match), excellent ratings, recent (within 3 years)',
  '- 4: Good relevant past performance (>75% match), good ratings, some gaps in coverage',
  '- 3: Moderate relevance (50-75% match), acceptable ratings, notable gaps',
  '- 2: Limited relevant past performance (<50% match), or older projects, significant gaps',
  '- 1: No relevant past performance, or poor ratings, critical gaps in required areas',
  '- Consider: technical similarity, domain similarity, scale similarity, recency, and performance ratings',
  '',
  'EVIDENCE FORMAT (IMPORTANT):',
  '- evidence MUST be an array of objects (NOT strings).',
  '- EvidenceRef keys allowed: source, snippet, chunkKey, documentId.',
  '- Use snippet for short quotes from solicitation.',
  '- Use chunkKey/documentId when referencing KB excerpts.',
  '- If no evidence, use [].',
  '',
  'NON-HALLUCINATION RULE:',
  '- Do not invent facts. Base scoring ONLY on the provided extracted sections, solicitation text, and KB excerpts.',
  '- If information is missing, note it in gaps[] and reduce confidence.',
].join('\n');

export const getScoringSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'SCORING') || {};
  return prompt || SCORING_SYSTEM_PROMPT;
};

export const useScoringSystemPrompt = async (orgId: string) => {
  return await getScoringSystemPrompt(orgId);
};

export const SCORING_USER_PROMPT = [
  'TASK: Produce Bid/No-Bid scoring and final recommendation for an Executive Opportunity Brief.',
  '',
  'Return JSON ONLY. First char "{" last char "}".',
  '',
  'COPY THIS JSON SKELETON AND FILL IT IN (do not add keys):',
  '{',
  '  "criteria": [',
  '    {',
  '      "name": "TECHNICAL_FIT",',
  '      "score": 3,',
  '      "rationale": "string (>=20 chars)",',
  '      "gaps": ["gap1", "gap2"],',
  '      "evidence": [ { "source": "SOLICITATION", "snippet": "short quote" } ]',
  '    },',
  '    { "name": "PAST_PERFORMANCE_RELEVANCE", "score": 3, "rationale": "string (>=20 chars)", "gaps": [], "evidence": [] },',
  '    { "name": "PRICING_POSITION", "score": 3, "rationale": "string (>=20 chars)", "gaps": [], "evidence": [] },',
  '    { "name": "STRATEGIC_ALIGNMENT", "score": 3, "rationale": "string (>=20 chars)", "gaps": [], "evidence": [] },',
  '    { "name": "INCUMBENT_RISK", "score": 3, "rationale": "string (>=20 chars)", "gaps": [], "evidence": [] }',
  '  ],',
  '  "compositeScore": 3.0,',
  '  "confidence": 70,',
  '  "summaryJustification": "string (>=20 chars)",',
  '  "decision": "CONDITIONAL_GO",',
  '  "decisionRationale": "string (>=30 chars): explain why this is GO/CONDITIONAL_GO/NO_GO",',
  '  "blockers": ["blocker1: must be resolved before bidding"],',
  '  "requiredActions": ["action1: required before bid submission"],',
  '  "confidenceExplanation": "string (>=20 chars): why this score confidence",',
  '  "confidenceDrivers": [ { "factor": "string", "direction": "UP|DOWN" } ]',
  '}',
  '',
  'SCORING GUIDANCE:',
  '1. TECHNICAL_FIT (1-5): Assess our capabilities against stated requirements.',
  '   - 5: Perfect alignment, proven track record on identical work',
  '   - 4: Strong fit, minor capability gaps',
  '   - 3: Acceptable fit, several gaps but achievable',
  '   - 2: Significant technical gaps, risky',
  '   - 1: Fundamental misalignment, unlikely to succeed',
  '',
  '2. PAST_PERFORMANCE_RELEVANCE (1-5): Do we have relevant past performance? (CRITICAL - often 30-40% of evaluation)',
  '   - 5: Multiple highly relevant past projects (>90% match), excellent ratings, recent (within 3 years)',
  '   - 4: Good relevant past performance (>75% match), good ratings, some gaps in coverage',
  '   - 3: Moderate relevance (50-75% match), acceptable ratings, notable gaps',
  '   - 2: Limited relevant past performance (<50% match), or older projects, significant gaps',
  '   - 1: No relevant past performance, or poor ratings, critical gaps in required areas',
  '   - Consider: technical similarity, domain similarity, scale similarity, recency, and performance ratings',
  '',
  '3. PRICING_POSITION (1-5): Can we price competitively while maintaining margin?',
  '   - 5: Strong pricing position, competitive rates, healthy margin',
  '   - 4: Good pricing position, minor adjustments needed',
  '   - 3: Acceptable pricing, may need to sharpen pencil',
  '   - 2: Pricing challenges, thin margins or above market',
  '   - 1: Cannot compete on price, significant gap',
  '',
  '4. STRATEGIC_ALIGNMENT (1-5): Does this opportunity align with our strategic goals?',
  '   - 5: Perfect strategic fit, builds portfolio, opens new markets',
  '   - 4: Good alignment, supports growth objectives',
  '   - 3: Moderate alignment, some strategic value',
  '   - 2: Limited strategic value, opportunistic only',
  '   - 1: Does not align with strategy, distraction',
  '',
  '5. INCUMBENT_RISK (1-5): What is the incumbent advantage? (Higher = less risk)',
  '   - 5: No incumbent, new requirement, or we are the incumbent',
  '   - 4: Weak incumbent, known issues, or level playing field',
  '   - 3: Moderate incumbent advantage, competitive recompete',
  '   - 2: Strong incumbent with good performance',
  '   - 1: Incumbent lock-in, wired deal, or brand-name requirement',
  '',
  'DECISION LOGIC:',
  '- compositeScore >= 4.0 → decision = GO',
  '- 3.0-3.99 → decision = GO or CONDITIONAL_GO (if blockers exist → CONDITIONAL_GO)',
  '- 2.0-2.99 → decision = CONDITIONAL_GO (major concerns, list blockers)',
  '- <2.0 → decision = NO_GO',
  '',
  'BLOCKER vs REQUIRED ACTION:',
  '- blocker: something that prevents us from competing (e.g., "Facility location requirement cannot be met")',
  '- requiredAction: something we must do before submitting bid (e.g., "Obtain security clearance for key personnel")',
  '',
  'CONFIDENCE (0-100):',
  '- Start at 85, subtract 5 for each unknown/gap in extracted data.',
  '- If more than 30% of required info is missing, confidence should be <70.',
  '',
  'EXTRACTED DATA (may be partial):',
  'SUMMARY: {{SUMMARY}}',
  '',
  'DEADLINES: {{DEADLINES}}',
  '',
  'REQUIREMENTS: {{REQUIREMENTS}}',
  '',
  'CONTACTS: {{CONTACTS}}',
  '',
  'RISKS: {{RISKS}}',
  '',
  'PAST PERFORMANCE ANALYSIS (matched projects from company database):',
  '{{PAST_PERFORMANCE}}',
  '',
  'COMPANY KB (capabilities): {{KB_TEXT}}',
  '',
  'FULL SOLICITATION TEXT: {{SOLICITATION}}',
].join('\n');

export const getScoringUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'SCORING') || {};
  return prompt || SCORING_USER_PROMPT;
};

export const useScoringUserPrompt = async (
  orgId: string,
  solicitation?: string,
  summary?: string,
  deadlines?: string,
  requirements?: string,
  contacts?: string,
  risks?: string,
  pastPerformance?: string,
  kbText?: string
) => {
  const prompt = await getScoringUserPrompt(orgId);
  return prompt
    .replace('{{SUMMARY}}', summary || 'None')
    .replace('{{DEADLINES}}', deadlines || 'None')
    .replace('{{REQUIREMENTS}}', requirements || 'None')
    .replace('{{CONTACTS}}', contacts || 'None')
    .replace('{{RISKS}}', risks || 'None')
    .replace('{{PAST_PERFORMANCE}}', pastPerformance || 'None - no past performance analysis available')
    .replace('{{KB_TEXT}}', kbText || 'None')
    .replace('{{SOLICITATION}}', solicitation || 'None');
};

export const ANSWER_SYSTEM_PROMPT = `
You are an expert proposal writer answering U.S. government RFP/SAM.gov solicitation questions.

CRITICAL: Return ONLY valid JSON. Do NOT include any extra text, explanations, or fields inside the "answer" value.

You may answer using:
1) The provided context chunks (preferred), AND
2) Common professional knowledge about proposal writing and typical government procurement practices (allowed only when context is missing).

Rules:
- Always return an answer (never leave it blank).
- If the answer is supported by the provided context, set "found" to true and set "source" to the single best chunkKey.
- If the context does NOT contain the needed information, you MUST:
  - set "found" to false
  - set "source" to ""
  - write an answer that is clearly framed as a GENERAL recommendation / template response (not a claim about this specific RFP).
- Never invent RFP-specific facts (deadlines, page limits, required forms, evaluation weights, email addresses, CLIN pricing, security requirements, etc.) unless explicitly present in the context.
- Do not write disclaimers like "based on the context" or "I don't have enough information". Instead:
  - If found=true: answer directly.
  - If found=false: give a best-practice answer + what to verify in the solicitation.
- The "answer" field must contain ONLY the answer text
- Do NOT put "Found =", "Source =", or any metadata inside the answer

Output:
Return ONLY valid JSON with exactly these keys (no extra keys, no markdown):

{
  "answer": "string",
  "confidence": 0.0,
  "found": true,
  "source": "chunkKey string",
  "notes": "string"
}

Confidence guidance:
- If grounded=true:
  - 0.85-1.0: explicitly stated in one chunk
  - 0.60-0.84: supported but lightly synthesized within one chunk
- If grounded=false:
  - 0.30-0.59: good general guidance/template
  - 0.00-0.29: question is too RFP-specific to answer; provide a minimal safe template and list exactly what must be verified

Citations:
- When grounded=true, choose ONE best chunkKey for "source".
- When grounded=false, "source" must be "".
`.trim();

export const ANSWER_USER_PROMPT = [
  'Context:',
  '"""',
  '{{CONTEXT}}',
  '"""',
  '',
  'Question: {{QUESTION}}',
].join('\n');

export const getAnswerSystemPrompt = async (orgId: string) => {
  const { prompt } = await readSystemPrompt(orgId, 'ANSWER') || {};
  return prompt || ANSWER_SYSTEM_PROMPT;
};

export const getAnswerUserPrompt = async (orgId: string) => {
  const { prompt } = await readUserPrompt(orgId, 'ANSWER') || {};
  return prompt || ANSWER_USER_PROMPT;
};

export const useAnswerUserPrompt = async (
  orgId: string,
  context: string,
  question: string,
) => {
  const prompt = await getAnswerUserPrompt(orgId);
  return prompt
    .replace('{{CONTEXT}}', context || '')
    .replace('{{QUESTION}}', question || '');
};
