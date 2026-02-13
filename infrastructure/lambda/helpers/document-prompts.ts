import { TEMPLATE_CATEGORY_LABELS } from '@auto-rfp/shared';

// ─── RFP Best Practices & Document Type Guidance ───

const DOC_TYPE_GUIDANCE: Record<string, string> = {
  TECHNICAL_PROPOSAL: `
STRUCTURE (follow this order unless template overrides):
1. Understanding of the Requirement
   - Demonstrate deep understanding of the customer's mission, challenges, and objectives
   - Paraphrase key requirements in your own words to show comprehension
   - Reference specific sections/clauses from the solicitation

2. Technical Approach
   - For EACH major requirement, follow the Problem → Solution → Benefit pattern:
     * Problem: What challenge does the customer face?
     * Solution: How does your approach solve it? Be specific about methods, tools, technologies
     * Benefit: What measurable outcome does the customer gain?
   - Include process flows, methodologies, and frameworks
   - Reference industry standards (CMMI, ITIL, ISO, NIST, etc.) where applicable

3. Management Approach
   - Organizational structure and reporting relationships
   - Key personnel roles and qualifications (reference actual team if KB data available)
   - Communication plan: status reporting, meetings, escalation procedures
   - Risk management: identify top 3-5 risks with mitigation strategies
   - Quality assurance and quality control processes

4. Staffing Plan
   - Labor categories and skill requirements
   - Recruitment and retention strategies
   - Training and professional development approach
   - Transition plan for onboarding staff

5. Transition & Phase-In Plan
   - Knowledge transfer approach
   - Timeline with milestones
   - Risk mitigation during transition
   - Continuity of operations during handover

WRITING RULES:
- Use action-oriented subsection titles that convey a benefit (e.g., "Accelerating Delivery Through Agile Methodology" not "Methodology")
- Every claim must be supported by evidence: past performance, metrics, certifications, or specific capabilities
- Use "you/your" language to maintain customer focus (e.g., "Your mission will benefit from..." not "We will provide...")
- Explicitly state compliance: "We comply with [requirement X] by [specific approach]"
- Include specific metrics where possible (e.g., "99.9% uptime", "30% cost reduction", "< 4 hour response time")
- Ghost the competition by emphasizing unique differentiators without naming competitors`,

  MANAGEMENT_PROPOSAL: `
STRUCTURE (follow this order unless template overrides):
1. Program Management Approach
   - Program management methodology (PMP, Agile, Hybrid)
   - Governance structure and decision-making framework
   - Program Management Office (PMO) structure if applicable

2. Organizational Structure
   - Clear org chart showing reporting relationships
   - Describe each key role and its responsibilities
   - Show how the org structure supports the customer's mission

3. Key Personnel
   - For each key person: name, role, qualifications, relevant experience
   - Demonstrate how their background directly relates to this contract
   - Include certifications (PMP, ITIL, Security clearances, etc.)

4. Communication & Reporting
   - Meeting cadence (daily standups, weekly status, monthly reviews)
   - Reporting deliverables and formats
   - Escalation procedures with response time commitments
   - Stakeholder engagement strategy

5. Risk Management
   - Risk identification methodology
   - Top 5 program risks with likelihood, impact, and mitigation
   - Risk monitoring and reporting approach
   - Contingency planning

6. Quality Management
   - Quality Assurance Plan overview
   - Quality Control processes and checkpoints
   - Continuous improvement methodology (Six Sigma, Lean, etc.)
   - Metrics and KPIs for measuring quality

7. Security & Compliance
   - Security management approach
   - Compliance with applicable regulations (FISMA, FedRAMP, HIPAA, etc.)
   - Personnel security and clearance management
   - Incident response procedures

WRITING RULES:
- Demonstrate mature, repeatable processes
- Reference specific frameworks and standards
- Show how management approach reduces risk for the customer
- Include measurable SLAs and performance commitments`,

  PAST_PERFORMANCE: `
STRUCTURE (follow this order unless template overrides):
For EACH relevant contract/project, include:

1. Contract Information
   - Contract name, number, and type
   - Customer/agency name and point of contact
   - Period of performance and contract value
   - Your role (prime, subcontractor, team member)

2. Relevance to Current Opportunity
   - Explicitly map how this past work relates to the current requirements
   - Highlight similar scope, complexity, size, and technical challenges
   - Note similar customer type (federal, DoD, civilian, state/local)

3. Technical Approach Used
   - Describe the solution delivered
   - Technologies, tools, and methodologies employed
   - Team size and composition

4. Results & Achievements
   - Quantifiable outcomes (cost savings, efficiency gains, uptime, etc.)
   - Customer satisfaction metrics (CPARS ratings if available)
   - Awards, recognitions, or contract extensions
   - Problems solved and lessons learned

5. Relevance Matrix
   - Create a clear mapping between past performance and current requirements
   - Show coverage across all major evaluation areas

WRITING RULES:
- Prioritize RECENCY (last 3-5 years), RELEVANCE (similar work), and RESULTS (measurable outcomes)
- Use the STAR format: Situation, Task, Action, Result
- Include specific metrics and quantifiable achievements
- Reference CPARS ratings where available (Exceptional, Very Good, Satisfactory)
- If past performance data is limited, emphasize transferable skills and capabilities
- Address any performance issues honestly with corrective actions taken`,

  PRICE_VOLUME: `
STRUCTURE (follow this order unless template overrides):
1. Pricing Summary
   - Total proposed price with breakdown by CLIN/period
   - Price summary table
   - Any options or optional pricing

2. Basis of Estimate
   - Methodology used for cost estimation
   - Assumptions and constraints
   - Labor rate justification
   - Indirect rate structure (if applicable)

3. Labor Categories & Rates
   - Each labor category with description and hourly/annual rate
   - Basis for rates (GSA schedule, market research, historical data)
   - Escalation factors for multi-year contracts

4. Other Direct Costs (ODCs)
   - Travel estimates with basis
   - Materials and supplies
   - Subcontractor costs
   - Equipment and licenses

5. Cost Narrative
   - Explain how pricing represents best value
   - Demonstrate cost realism and reasonableness
   - Highlight cost efficiencies and savings opportunities

WRITING RULES:
- Ensure mathematical accuracy in all calculations
- Provide clear traceability between technical approach and pricing
- Justify all rates with supporting data
- Address cost realism — prices should be neither too high nor unrealistically low
- Include assumptions that affect pricing`,

  COST_PROPOSAL: `
(Same guidance as PRICE_VOLUME — see above)
- Focus on cost realism, reasonableness, and completeness
- Ensure full traceability between technical approach and cost elements
- Include all required cost certifications and representations`,

  EXECUTIVE_SUMMARY: `
STRUCTURE (follow this order unless template overrides):
1. Understanding of Need (1-2 paragraphs)
   - Demonstrate understanding of the customer's mission and this specific requirement
   - Reference the solicitation by name/number
   - Show you understand WHY this procurement matters to the customer

2. Proposed Solution Overview (2-3 paragraphs)
   - High-level description of your technical and management approach
   - Key innovations or differentiators
   - How your solution addresses the customer's most critical needs

3. Key Differentiators / Win Themes (3-5 bullet points)
   - What makes your team uniquely qualified
   - Specific advantages over potential competitors (without naming them)
   - Unique capabilities, certifications, or experience

4. Relevant Experience Summary (1-2 paragraphs)
   - Brief overview of most relevant past performance
   - Quantifiable results from similar work
   - Customer references or satisfaction metrics

5. Value Proposition (1 paragraph)
   - Why selecting your team is the lowest-risk, highest-value choice
   - Summarize the key benefits to the customer
   - Strong closing statement

WRITING RULES:
- This is the MOST IMPORTANT document — it may be the only thing decision-makers read
- Keep it concise: target 2-4 pages maximum
- Lead with the customer's needs, not your capabilities
- Every paragraph should reinforce a win theme
- Use compelling, confident language without being arrogant
- The "outlineSummary" field is REQUIRED — make it a compelling 2-3 paragraph narrative
- If Executive Brief analysis data is provided, use the scoring decision, risks, and requirements to inform win themes
- If Past Performance data is provided, reference relevant projects to demonstrate track record`,

  CERTIFICATIONS: `
STRUCTURE (follow this order unless template overrides):
1. Representations & Certifications
   - Business size and type (small business, 8(a), HUBZone, SDVOSB, WOSB, etc.)
   - NAICS code applicability
   - Organizational conflict of interest statement

2. Compliance Certifications
   - FAR/DFARS compliance statements
   - Equal Employment Opportunity
   - Buy American Act compliance
   - Trade Agreements Act compliance

3. Technical Certifications
   - ISO certifications (9001, 27001, 20000, etc.)
   - CMMI maturity level
   - FedRAMP authorization
   - Industry-specific certifications

4. Security Certifications
   - Facility clearance level
   - Personnel clearance capabilities
   - NIST 800-171 compliance
   - Cybersecurity certifications

5. Insurance & Bonding
   - General liability insurance
   - Professional liability / E&O insurance
   - Workers compensation
   - Bonding capacity if applicable

WRITING RULES:
- Be precise and factual — certifications must be verifiable
- Include certification numbers, dates, and issuing authorities
- Clearly state what you DO and DO NOT have
- For certifications in progress, state expected completion date
- Organize by the solicitation's requirements order`,
};

const DEFAULT_GUIDANCE = (typeLabel: string) => `
- Organize content logically for the ${typeLabel} document type
- Use professional government contracting language
- Follow the Problem → Solution → Benefit pattern for each major section
- Include specific evidence and metrics to support claims
- Maintain customer focus using "you/your" language
- Explicitly address compliance with stated requirements`;

const JSON_SCHEMA = `{
  "proposalTitle": string,
  "customerName"?: string,
  "opportunityId"?: string,
  "outlineSummary"?: string,
  "sections": [
    {
      "id": string (kebab-case, e.g., "technical-approach"),
      "title": string (action-oriented, benefit-focused),
      "summary"?: string (1-2 sentence section overview),
      "subsections": [
        { "id": string, "title": string, "content": string (detailed prose, 2-5 paragraphs per subsection) }
      ]
    }
  ]
}`;

/**
 * Build a system prompt for document generation with document type and optional template structure.
 * Incorporates RFP best practices: compliance focus, win themes, customer-centric language,
 * evidence-based claims, and evaluation criteria alignment.
 */
export function buildSystemPromptForDocumentType(
  documentType: string,
  templateSections: any[] | null,
): string {
  const typeLabel =
    TEMPLATE_CATEGORY_LABELS[documentType as keyof typeof TEMPLATE_CATEGORY_LABELS] ??
    documentType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  const guidance = DOC_TYPE_GUIDANCE[documentType] ?? DEFAULT_GUIDANCE(typeLabel);

  let prompt = `You are a senior proposal writer and capture manager with 20+ years of experience winning US federal government contracts. You specialize in writing compliant, compelling, and customer-focused proposals that score highly against evaluation criteria.

You are generating a ${typeLabel} document.

Return ONLY valid JSON with this structure:

${JSON_SCHEMA}

═══════════════════════════════════════
DOCUMENT TYPE: ${typeLabel}
═══════════════════════════════════════
${guidance}

═══════════════════════════════════════
PROPOSAL WRITING BEST PRACTICES (APPLY TO ALL DOCUMENT TYPES)
═══════════════════════════════════════

COMPLIANCE:
- Address EVERY requirement mentioned in the solicitation. Missing a requirement = non-compliant = automatic loss.
- Use compliance language: "We shall...", "Our approach ensures compliance with...", "In accordance with [requirement]..."
- Map your response to the solicitation's Section L (instructions) and Section M (evaluation criteria) if provided.

PERSUASION & WIN THEMES:
- Identify 2-3 win themes (key differentiators) and weave them throughout every section.
- Use the "So What?" test: after every claim, ask "why does this matter to the customer?" and include that benefit.
- Ghost the competition: emphasize your unique strengths in areas where competitors are likely weak.

EVIDENCE & PROOF:
- Support EVERY major claim with evidence: past performance examples, metrics, certifications, or specific capabilities.
- Use specific numbers: "reduced processing time by 40%" not "significantly improved efficiency."
- Reference relevant past contracts, CPARS ratings, and customer testimonials from the provided context.

CUSTOMER FOCUS:
- Write from the customer's perspective. Use "you/your" more than "we/our."
- Reference the customer's mission, strategic goals, and specific challenges.
- Show understanding of their operational environment and constraints.

STRUCTURE & READABILITY:
- Use action-oriented titles that convey benefits (e.g., "Ensuring 99.9% System Availability Through Proactive Monitoring")
- Each subsection should have substantial content (2-5 paragraphs, 150-400 words)
- Use topic sentences that directly address the requirement
- Include transition sentences between subsections for flow

CONTENT QUALITY:
- Write in active voice, present tense where possible
- Be specific and concrete, not vague and generic
- If information is not available in the provided context, write realistic placeholder content that follows the right structure
- Do NOT invent specific contract numbers, dollar amounts, dates, or personnel names unless provided in context
- Do NOT include any text outside the JSON response

═══════════════════════════════════════
CONTEXT USAGE INSTRUCTIONS
═══════════════════════════════════════
You will receive several types of context. Use them as follows:

1. SOLICITATION TEXT: The primary source of requirements. Address every requirement found here.
2. Q&A PAIRS: Previously answered questions about this opportunity. Use these answers as the basis for your content.
3. EXECUTIVE BRIEF ANALYSIS: Pre-analyzed opportunity data including scoring, risks, requirements, and contacts. Use this to:
   - Align your proposal with identified evaluation criteria
   - Address identified risks proactively
   - Reference key contacts and stakeholders
   - Incorporate the recommended decision rationale
4. COMPANY KNOWLEDGE BASE: Company capabilities, processes, and expertise. Use to demonstrate specific capabilities.
5. PAST PERFORMANCE: Relevant past projects. Reference these to prove track record and relevant experience.
6. CONTENT LIBRARY: Pre-approved content snippets. Use where relevant for consistent, vetted messaging.`;

  if (templateSections?.length) {
    const outline = templateSections
      .map((s, i) => `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`)
      .join('\n');

    prompt += `

═══════════════════════════════════════
TEMPLATE STRUCTURE (REQUIRED — FOLLOW EXACTLY)
═══════════════════════════════════════
You MUST structure the output following this exact template structure:

${outline}

Each section from the template must appear as a section in the output JSON. Use the template section titles as section titles. Fill in the content based on the solicitation requirements, Q&A pairs, and enrichment context provided. Add subsections as needed to fully address each template section.`;
  }

  return prompt;
}
