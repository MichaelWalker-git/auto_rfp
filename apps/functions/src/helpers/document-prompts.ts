import { TEMPLATE_CATEGORY_LABELS, RFP_DOCUMENT_TYPES } from '@auto-rfp/core';

// ─── RFP Best Practices & Document Type Guidance ───

const DOC_TYPE_GUIDANCE: Record<string, string> = {
  COVER_LETTER: `
STRUCTURE (follow this order unless template overrides):
1. Opening — Addressee & Intent
   - Address by name to the Contracting Officer or Source Selection Authority if known
   - State the solicitation number, title, and your intent to submit a compliant proposal
   - One compelling opening sentence that frames your unique value

2. Why We Are the Right Choice (2-3 sentences)
   - Your single most powerful differentiator for THIS opportunity
   - Reference a specific past performance result that directly mirrors this requirement
   - Tie your capability to the customer's stated mission or strategic goal

3. Proposal Overview
   - Brief statement of what volumes/sections are enclosed
   - Confirm compliance with all submission requirements (page limits, formats, attachments)
   - Note any clarifications or assumptions if applicable

4. Commitment Statement
   - Senior executive commitment to the program
   - Point of contact name, title, phone, and email for questions
   - Signature block (Name, Title, Organization, Date)

WRITING RULES:
- Keep to ONE page maximum — evaluators read hundreds of cover letters
- Use the customer's name and solicitation title in the first paragraph
- Lead with the customer's need, not your company history
- The opening sentence should be a hook: reference their mission or a specific challenge
- Sign at the VP level or above to signal organizational commitment
- Do NOT use generic boilerplate — every sentence must be specific to this opportunity
- If Past Performance data is available, reference the single most relevant project by name`,

  UNDERSTANDING_OF_REQUIREMENTS: `
STRUCTURE (follow this order unless template overrides):
1. Mission & Strategic Context
   - Articulate the customer's broader mission and how this procurement supports it
   - Reference the agency's strategic plan, NDAA requirements, or published priorities
   - Show you understand WHY this procurement exists, not just WHAT is being procured

2. Current State & Challenges
   - Describe the current environment, pain points, and operational gaps
   - Reference specific challenges mentioned in the solicitation or known from industry research
   - Quantify the impact of the current state where possible (cost, time, risk)

3. Requirements Analysis
   - Walk through the key requirements, grouped by theme or priority
   - For each major requirement, demonstrate your understanding of its intent
   - Distinguish between mandatory requirements and evaluation factors
   - Identify interdependencies between requirements

4. Critical Success Factors
   - What does success look like for the customer at 6 months, 1 year, end of contract?
   - What are the top 3-5 factors that will determine whether this program succeeds?
   - How does your approach address each critical success factor?

5. Our Interpretation & Approach Preview
   - Briefly state how you interpret the requirements and your proposed approach
   - This bridges into the Technical Proposal section
   - Reinforce that your team has done this before (reference past performance)

WRITING RULES:
- This section BUILDS TRUST — evaluators want to see you "get it" before they trust your solution
- Use the customer's exact terminology from the solicitation
- Avoid generic statements like "we understand your requirements" — be specific
- Reference specific sections, paragraphs, or clauses from the solicitation
- If Executive Brief analysis is available, use the requirements and risks sections to inform this content
- Demonstrate domain expertise through specific, accurate statements about the customer's environment`,

  PROJECT_PLAN: `
STRUCTURE (follow this order unless template overrides):
1. Program Overview & Approach
   - High-level description of your project management methodology (Agile, Waterfall, Hybrid)
   - How the methodology aligns with the customer's environment and requirements
   - Key principles guiding your execution approach

2. Work Breakdown Structure (WBS)
   - Major work packages and deliverables organized hierarchically
   - Clear ownership for each work package
   - Traceability from WBS to contract requirements

3. Phased Timeline & Milestones
   - Phase 1: Transition/Kickoff (Days 1-30 typically)
   - Phase 2: Initial Operating Capability
   - Phase 3: Full Operating Capability
   - Phase 4: Steady State Operations
   - For each phase: objectives, key activities, deliverables, and success criteria
   - Include specific milestone dates tied to the period of performance

4. Deliverables Schedule
   - Complete list of all contract deliverables (CDRLs/DIDs if applicable)
   - Delivery dates, formats, and submission procedures
   - Review and approval cycles

5. Resource Plan
   - Staffing levels by phase and labor category
   - Key personnel availability and commitment
   - Subcontractor integration plan if applicable

6. Schedule Risk & Contingency
   - Top 3 schedule risks with probability and impact
   - Mitigation strategies and contingency buffers
   - Critical path identification

WRITING RULES:
- Realistic timelines beat optimistic ones — evaluators are skeptical of "too good to be true" schedules
- Include buffer time (10-15%) for government review cycles and approvals
- Reference similar projects from Past Performance to validate timeline estimates
- Show you understand the customer's operational tempo and constraints
- If solicitation specifies milestones, map your plan directly to those milestones
- Use specific dates where the period of performance is known`,

  TEAM_QUALIFICATIONS: `
STRUCTURE (follow this order unless template overrides):
1. Organizational Overview
   - Company overview: size, years in business, relevant certifications (CMMI, ISO, etc.)
   - Relevant business size/socioeconomic status (small business, 8(a), HUBZone, SDVOSB, etc.)
   - Organizational structure and how it supports this contract

2. Program Organizational Chart
   - Clear org chart showing all key positions and reporting relationships
   - Show the customer's POC chain and escalation path
   - Identify which positions are filled vs. to-be-hired

3. Key Personnel Profiles
   For EACH key person (Program Manager, Technical Lead, etc.):
   - Name, proposed role, and years of relevant experience
   - Education and professional certifications (PMP, CISSP, clearance level, etc.)
   - 3-5 bullet points of directly relevant experience
   - Specific accomplishments with quantified results
   - Why this person is uniquely qualified for THIS role on THIS contract

4. Staffing Plan
   - Total headcount by labor category and phase
   - Recruitment strategy for any open positions
   - Retention strategy and key personnel commitment
   - Subcontractor roles and qualifications (if applicable)

5. Corporate Capabilities
   - Relevant corporate experience and certifications
   - Facilities, clearances, and infrastructure
   - Training and professional development programs

WRITING RULES:
- Use ACTUAL names and bios from the Knowledge Base if available — do not invent personnel
- If KB has past performance data with team members, reference them
- Highlight certifications that are specifically required or preferred in the solicitation
- Show continuity: if proposing incumbents or known team members, emphasize stability
- For each key person, explicitly state how their background maps to THIS contract's requirements
- Include security clearance levels if required by the solicitation
- If Past Performance data is available, reference team members who worked on similar contracts`,

  RISK_MANAGEMENT: `
STRUCTURE (follow this order unless template overrides):
1. Risk Management Approach
   - Risk management methodology and framework (e.g., PMI PMBOK, DoD Risk Management Guide)
   - Risk identification, assessment, and monitoring processes
   - Risk register maintenance and reporting cadence
   - Roles and responsibilities for risk management

2. Risk Assessment Matrix
   - Likelihood scale (1-5) and Impact scale (1-5) definitions
   - Risk scoring methodology
   - Risk thresholds for escalation

3. Top Program Risks & Mitigations
   For EACH identified risk (minimum 5-7 risks):
   - Risk ID and title
   - Risk description: what could go wrong and why
   - Likelihood (Low/Medium/High) and Impact (Low/Medium/High)
   - Risk score (Likelihood × Impact)
   - Mitigation strategy: specific actions to reduce likelihood or impact
   - Contingency plan: what you will do if the risk materializes
   - Risk owner: who is responsible for monitoring and mitigating

   Risk categories to address:
   - Technical risks (technology maturity, integration complexity)
   - Schedule risks (dependencies, resource availability, government delays)
   - Cost risks (labor rate changes, scope creep, subcontractor performance)
   - Personnel risks (key person departure, clearance delays)
   - External risks (regulatory changes, supply chain, cyber threats)

4. Risk Monitoring & Reporting
   - How risks will be tracked (risk register, dashboard)
   - Reporting frequency and format
   - Escalation procedures and thresholds
   - Continuous risk identification process

WRITING RULES:
- Acknowledging risks (and having plans for them) builds MORE confidence than pretending there are none
- Be specific about mitigations — "we will monitor" is not a mitigation
- If Executive Brief analysis has identified risks, incorporate those into this section
- Reference past performance examples where you successfully mitigated similar risks
- Show the customer that risk management is a proactive, ongoing process — not a one-time exercise
- Include at least one risk related to the customer's own actions (government-furnished equipment delays, slow approvals) with diplomatic language`,

  COMPLIANCE_MATRIX: `
STRUCTURE (follow this order unless template overrides):
1. Introduction
   - Purpose of the compliance matrix
   - How to use the matrix to evaluate the proposal
   - Reference to Section L (instructions) and Section M (evaluation criteria)

2. Section L Compliance Matrix (Instructions to Offerors)
   Create a table with columns:
   - Requirement #: Section/paragraph reference from the solicitation
   - Requirement Description: Brief description of the requirement
   - Compliance: YES / PARTIAL / N/A
   - Proposal Location: Volume, section, and page number where addressed
   - Notes: Any clarifications or assumptions

3. Section M Compliance Matrix (Evaluation Criteria)
   Create a table with columns:
   - Evaluation Factor: Name of the evaluation factor
   - Weight/Importance: Relative weight if stated in solicitation
   - Where Addressed: Volume, section, and page number
   - Key Discriminators: Your strongest points for this factor
   - Evidence: Specific past performance or capability that supports this factor

4. Technical Requirements Traceability
   - Map each Statement of Work (SOW) or Performance Work Statement (PWS) requirement
   - Show which section of your proposal addresses each requirement
   - Flag any requirements addressed in multiple sections

5. Deliverables Compliance
   - List all required deliverables (CDRLs, reports, plans)
   - Confirm compliance with format, frequency, and submission requirements

WRITING RULES:
- This section is a GIFT to evaluators — it makes their job easier and earns you full marks
- Be precise with page/section references — evaluators will check
- If a requirement is addressed in multiple places, list all locations
- For PARTIAL compliance, explain what is partial and why
- Never mark something as compliant if it is not — evaluators will find it
- If the solicitation has a required compliance matrix format, use it exactly
- This section should be the LAST thing written, after all other sections are complete`,

  APPENDICES: `
STRUCTURE (follow this order unless template overrides):
1. Resumes / Curriculum Vitae
   - Full resumes for all key personnel proposed
   - Format: Name, Education, Certifications, Professional Experience (reverse chronological)
   - Highlight experience directly relevant to this contract
   - Include security clearance level if applicable

2. Past Performance References
   - Detailed past performance sheets for each referenced contract
   - Include: Contract name/number, customer POC with contact info, period of performance, contract value, scope description, your role, results achieved
   - CPARS ratings if available

3. Certifications & Licenses
   - Copies or summaries of relevant certifications (ISO, CMMI, FedRAMP, etc.)
   - Professional licenses and registrations
   - Security clearance facility certification (if applicable)

4. Letters of Commitment / Support
   - Letters from key personnel confirming availability
   - Teaming partner commitment letters
   - Letters of support from past customers (if permitted)

5. Technical Diagrams & Architecture
   - System architecture diagrams
   - Process flow diagrams
   - Network diagrams
   - Any technical illustrations referenced in the proposal

6. Sample Deliverables / Work Products
   - Sanitized examples of similar deliverables from past contracts
   - Sample reports, plans, or technical documents
   - Demonstrates quality and format of your work products

7. Financial Information (if required)
   - Audited financial statements or Dun & Bradstreet report
   - Evidence of financial stability and bonding capacity

WRITING RULES:
- Only include appendices that are explicitly required or directly support your proposal
- Reference each appendix from the main proposal body (e.g., "See Appendix A for full resume")
- Sanitize any proprietary or sensitive information from sample work products
- Ensure all resumes are current and accurate — evaluators may contact references
- If the solicitation specifies appendix format or page limits, follow them exactly`,

  QUALITY_MANAGEMENT: `
STRUCTURE (follow this order unless template overrides):
1. Quality Management Philosophy & Framework
   - Quality management methodology (ISO 9001, CMMI, Six Sigma, etc.)
   - Quality policy statement
   - How quality is embedded in all processes, not just inspected at the end

2. Quality Assurance (QA) Plan
   - QA activities: audits, reviews, process assessments
   - QA roles and responsibilities (independent QA function)
   - QA reporting and escalation procedures
   - Compliance with applicable standards (ISO, NIST, CMMI, etc.)

3. Quality Control (QC) Processes
   - QC checkpoints for each major deliverable type
   - Peer review and technical review processes
   - Testing and validation procedures
   - Defect tracking and resolution process

4. Performance Metrics & KPIs
   - Key quality metrics (defect rates, rework rates, customer satisfaction scores)
   - Measurement methodology and data collection
   - Reporting frequency and format
   - Thresholds for corrective action

5. Continuous Improvement
   - Lessons learned process
   - Root cause analysis methodology
   - Process improvement initiatives
   - How improvements are documented and shared

6. Customer Satisfaction Management
   - Customer feedback collection methods
   - Satisfaction survey process and frequency
   - How feedback drives improvement
   - Escalation path for customer concerns

WRITING RULES:
- Show that quality is proactive, not reactive
- Reference specific quality certifications and their applicability to this contract
- Include measurable quality commitments (e.g., "99.5% on-time delivery of deliverables")
- If Past Performance data shows quality metrics, reference them as evidence
- Demonstrate how your QA/QC processes have prevented issues on similar contracts`,

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
  "title": string,
  "customerName"?: string,
  "opportunityId"?: string,
  "outlineSummary"?: string,
  "htmlContent": string  (complete styled HTML document — see HTML REQUIREMENTS below)
}`;

const HTML_REQUIREMENTS = `
═══════════════════════════════════════
HTML CONTENT REQUIREMENTS
═══════════════════════════════════════
The "htmlContent" field MUST be a complete, well-structured HTML document body (no <html>/<head>/<body> tags — just the inner content).

Use the following HTML elements and inline styles to produce a professional, readable document:

HEADINGS:
- <h1 style="font-size:2em;font-weight:700;margin:0 0 0.5em;color:#1a1a2e;border-bottom:3px solid #4f46e5;padding-bottom:0.3em"> — Document title
- <h2 style="font-size:1.4em;font-weight:700;margin:1.5em 0 0.5em;color:#1a1a2e;border-bottom:1px solid #e2e8f0;padding-bottom:0.2em"> — Major sections
- <h3 style="font-size:1.1em;font-weight:600;margin:1.2em 0 0.4em;color:#374151"> — Subsections

PARAGRAPHS:
- <p style="margin:0 0 1em;line-height:1.7;color:#374151"> — Body text

LISTS:
- <ul style="margin:0 0 1em;padding-left:1.5em"> with <li style="margin-bottom:0.4em;line-height:1.6;color:#374151">
- <ol style="margin:0 0 1em;padding-left:1.5em"> with <li style="margin-bottom:0.4em;line-height:1.6;color:#374151">

TABLES (for compliance matrices, risk registers, etc.):
- <table style="width:100%;border-collapse:collapse;margin:1em 0">
- <thead><tr style="background:#4f46e5;color:#fff">
- <th style="padding:0.6em 0.8em;text-align:left;font-weight:600;font-size:0.9em">
- <tbody><tr style="border-bottom:1px solid #e2e8f0"> (alternate: background:#f8fafc)
- <td style="padding:0.6em 0.8em;font-size:0.9em;color:#374151">

CALLOUT BOXES (for win themes, key points):
- <div style="background:#eff6ff;border-left:4px solid #4f46e5;padding:1em 1.2em;margin:1em 0;border-radius:0 6px 6px 0">

EMPHASIS:
- <strong> for bold key terms
- <em> for italics

DOCUMENT STRUCTURE PATTERN:
1. Start with the document title in <h1>
2. Add a brief executive overview in a callout box <div style="background:#eff6ff...">
3. Use <h2> for each major section
4. Use <h3> for subsections within each major section
5. Use <p> for body text, <ul>/<ol> for lists, <table> for structured data
6. End with a professional closing statement

IMPORTANT:
- Generate COMPLETE, DETAILED content — not placeholders
- Each major section should have 3-6 paragraphs of substantive content
- The HTML must be valid and renderable in a browser
- Do NOT include \`\`\`html fences or any text outside the JSON object`;

/**
 * Build a system prompt for document generation with document type and optional template structure.
 * When a template HTML scaffold is provided, the model is instructed to fill it in exactly.
 * Incorporates RFP best practices: compliance focus, win themes, customer-centric language,
 * evidence-based claims, and evaluation criteria alignment.
 */
export function buildSystemPromptForDocumentType(
  documentType: string,
  templateSections: any[] | null,
  templateHtmlScaffold?: string | null,
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
6. CONTENT LIBRARY: Pre-approved content snippets. Use where relevant for consistent, vetted messaging.

${HTML_REQUIREMENTS}`;

  if (templateHtmlScaffold) {
    // HTML scaffold takes priority — model fills in the pre-structured template
    prompt += `

═══════════════════════════════════════
⚠️  MANDATORY HTML TEMPLATE SCAFFOLD — OVERRIDE ALL OTHER STRUCTURE GUIDANCE ⚠️
═══════════════════════════════════════
A pre-approved HTML template has been provided. This template OVERRIDES all document structure guidance above.
You MUST use this scaffold as the EXACT structure for "htmlContent". Do NOT deviate from it.

STRICT INSTRUCTIONS:
1. PRESERVE ALL HEADINGS: Keep every <h1>, <h2>, <h3> heading exactly as written. Do NOT rename, reorder, or remove any heading.
2. FILL ALL PLACEHOLDERS: Replace every [CONTENT: ...], [placeholder], and [Your ...] marker with real, detailed, substantive content based on the solicitation and context provided.
3. KEEP BOILERPLATE: Any text that is NOT a placeholder is pre-approved content — keep it exactly as written.
4. EXPAND CONTENT: Add <h3> subsections and <p> paragraphs within each section as needed to produce a complete, professional document.
5. NO REMOVALS: Do NOT remove any section, heading, or structural element from the template.
6. COMPLETE HTML: The final "htmlContent" must be a complete, valid HTML body (no <html>/<head>/<body> tags).
7. IGNORE STRUCTURE GUIDANCE ABOVE: The document type structure guidance above is SUPERSEDED by this template.

TEMPLATE SCAFFOLD (FOLLOW EXACTLY):
${templateHtmlScaffold}`;
  } else if (templateSections?.length) {
    // Legacy: section outline only (no HTML scaffold)
    const outline = templateSections
      .map((s: { title: string; description?: string }, i: number) =>
        `${i + 1}. ${s.title}${s.description ? ` — ${s.description}` : ''}`)
      .join('\n');

    prompt += `

═══════════════════════════════════════
TEMPLATE STRUCTURE (REQUIRED — FOLLOW EXACTLY)
═══════════════════════════════════════
You MUST structure the htmlContent following this exact section order:

${outline}

Use these section titles as <h2> headings. Fill in the content based on the solicitation requirements, Q&A pairs, and enrichment context provided.`;
  }

  return prompt;
}

// ─── Per-document-type task instructions ───
// Each entry describes WHAT the model should focus on for this specific document type.
// These are injected into the user prompt's TASK section to tailor the generation.

const DOC_TYPE_TASK: Record<string, string> = {
  COVER_LETTER: `
YOUR TASK — Cover Letter:
1. Write a ONE-PAGE cover letter addressed to the Contracting Officer (use name from contacts if available).
2. Open with a compelling hook that references the customer's mission or a specific challenge from the solicitation.
3. State your single most powerful differentiator and tie it to a specific past performance result.
4. Briefly list the enclosed proposal volumes and confirm compliance with all submission requirements.
5. Close with a senior executive commitment statement and full contact information.
6. Use the solicitation title and number in the first paragraph.
7. Return ONLY valid JSON in the required format.`,

  EXECUTIVE_SUMMARY: `
YOUR TASK — Executive Summary:
1. Write a compelling 2-4 page executive summary — the most-read section of any proposal.
2. Lead with the customer's mission and why this procurement matters to them (not your capabilities).
3. Develop 3 win themes from the company's strengths and weave them throughout every paragraph.
4. Summarize your technical approach, management approach, and past performance in 1-2 paragraphs each.
5. Close with a strong value proposition: why your team is the lowest-risk, highest-value choice.
6. The "outlineSummary" field MUST be a compelling 2-3 paragraph narrative — this is required.
7. Use Executive Brief scoring/decision data if available to align with evaluation criteria.
8. Return ONLY valid JSON in the required format.`,

  UNDERSTANDING_OF_REQUIREMENTS: `
YOUR TASK — Understanding of Requirements:
1. Demonstrate that you fully understand the customer's mission, environment, and the WHY behind this procurement.
2. Describe the current state, pain points, and operational gaps using specific language from the solicitation.
3. Walk through the key requirements grouped by theme, showing you understand the intent of each.
4. Identify the top 3-5 critical success factors and explain how your approach addresses each.
5. Use the Executive Brief requirements analysis if available to ensure complete coverage.
6. Mirror the customer's exact terminology — do not paraphrase into generic language.
7. Return ONLY valid JSON in the required format.`,

  TECHNICAL_PROPOSAL: `
YOUR TASK — Technical Proposal:
1. ANALYZE the solicitation to identify ALL technical requirements and evaluation criteria.
2. For EACH major requirement, apply the Problem → Solution → Benefit pattern with specific details.
3. Include your technical methodology, tools, technologies, and frameworks with justification.
4. Address management approach, staffing plan, and transition/phase-in plan.
5. Reference industry standards (CMMI, ITIL, ISO, NIST) where applicable.
6. Support every claim with evidence from past performance, KB, or content library.
7. ENSURE every requirement from the solicitation is addressed somewhere in the proposal.
8. Return ONLY valid JSON in the required format.`,

  PROJECT_PLAN: `
YOUR TASK — Project Plan:
1. Define a phased project timeline with clear milestones, deliverables, and success criteria for each phase.
2. Include a Work Breakdown Structure (WBS) with ownership for each work package.
3. Map your timeline to any milestones or periods of performance stated in the solicitation.
4. Include a resource plan showing staffing levels by phase and labor category.
5. Identify the top 3 schedule risks with mitigation strategies and contingency buffers.
6. Reference similar past performance projects to validate your timeline estimates.
7. Use realistic schedules — include 10-15% buffer for government review cycles.
8. Return ONLY valid JSON in the required format.`,

  TEAM_QUALIFICATIONS: `
YOUR TASK — Team Qualifications:
1. Present the organizational structure and how it supports this specific contract.
2. For EACH key personnel role, provide a detailed profile: name (if available from KB), role, experience, certifications, and specific accomplishments with metrics.
3. Explicitly map each person's background to THIS contract's requirements.
4. Include a staffing plan with headcount by labor category and phase.
5. Use ACTUAL personnel data from the Knowledge Base if available — do not invent names.
6. Highlight certifications specifically required or preferred in the solicitation.
7. Reference past performance projects where team members delivered similar work.
8. Return ONLY valid JSON in the required format.`,

  PAST_PERFORMANCE: `
YOUR TASK — Past Performance:
1. Present 3-5 highly relevant past contracts using the STAR format (Situation, Task, Action, Result).
2. For EACH contract: include contract info, explicit relevance mapping to current requirements, technical approach used, and quantified results.
3. Prioritize RECENCY (last 3-5 years), RELEVANCE (similar scope/complexity), and RESULTS (measurable outcomes).
4. Create a relevance matrix showing coverage across all major evaluation areas.
5. Use ALL past performance data from the enrichment context — this is your primary source.
6. Include CPARS ratings where available (Exceptional, Very Good, Satisfactory).
7. If past performance data is limited, emphasize transferable capabilities and relevant domain experience.
8. Return ONLY valid JSON in the required format.`,

  COST_PROPOSAL: `
YOUR TASK — Cost Proposal:
1. Present a detailed cost breakdown by labor category, ODCs, and period of performance.
2. Provide a basis of estimate explaining your cost estimation methodology and assumptions.
3. Justify all labor rates with supporting data (GSA schedule, market research, historical data).
4. Include escalation factors for multi-year contracts.
5. Write a cost narrative explaining how your pricing represents best value and demonstrates cost realism.
6. Ensure full traceability between your technical approach and cost elements.
7. Do NOT invent specific dollar amounts — use placeholder ranges or methodology descriptions if actual rates are not in context.
8. Return ONLY valid JSON in the required format.`,

  MANAGEMENT_APPROACH: `
YOUR TASK — Management Approach:
1. Describe your program management methodology (PMP, Agile, Hybrid) and governance structure.
2. Present the communication plan: meeting cadence, reporting deliverables, escalation procedures.
3. Describe your QA/QC processes with specific checkpoints and metrics.
4. Include a risk management overview with top 5 risks and mitigations.
5. Show how your management approach reduces risk and ensures on-time, on-budget delivery.
6. Reference specific frameworks and standards (PMBOK, CMMI, ISO) with applicability to this contract.
7. Include measurable SLAs and performance commitments.
8. Return ONLY valid JSON in the required format.`,

  RISK_MANAGEMENT: `
YOUR TASK — Risk Management:
1. Describe your risk management methodology and framework (PMI PMBOK, DoD Risk Management Guide).
2. Present a risk assessment matrix with likelihood and impact scales.
3. Identify and detail a MINIMUM of 5-7 program risks across all categories: technical, schedule, cost, personnel, external.
4. For EACH risk: provide description, likelihood, impact, risk score, specific mitigation strategy, contingency plan, and risk owner.
5. Use Executive Brief risk analysis if available — incorporate identified red flags and risks.
6. Reference past performance examples where you successfully mitigated similar risks.
7. Include at least one government-side risk (GFE delays, slow approvals) with diplomatic language.
8. Return ONLY valid JSON in the required format.`,

  COMPLIANCE_MATRIX: `
YOUR TASK — Compliance Matrix:
1. Create a comprehensive compliance matrix mapping EVERY solicitation requirement to your proposal.
2. Build a Section L matrix (instructions to offerors) with: requirement reference, description, compliance status (YES/PARTIAL/N/A), proposal location, and notes.
3. Build a Section M matrix (evaluation criteria) with: factor name, weight, where addressed, key discriminators, and supporting evidence.
4. Map each SOW/PWS requirement to the specific proposal section that addresses it.
5. List all required deliverables with format, frequency, and submission confirmation.
6. Use the solicitation text as the primary source — extract every requirement systematically.
7. Never mark something as compliant if it is not — be accurate.
8. Return ONLY valid JSON in the required format.`,

  CERTIFICATIONS: `
YOUR TASK — Certifications:
1. Present all required representations and certifications from the solicitation.
2. Include business size/type certifications (small business, 8(a), HUBZone, SDVOSB, WOSB, etc.).
3. List FAR/DFARS compliance statements required by the solicitation.
4. Present technical certifications (ISO, CMMI, FedRAMP) with certification numbers and dates from KB if available.
5. Include security certifications and clearance capabilities.
6. List insurance and bonding information if required.
7. Use ONLY verifiable information from the Knowledge Base — do not invent certification numbers or dates.
8. Return ONLY valid JSON in the required format.`,

  APPENDICES: `
YOUR TASK — Appendices:
1. Organize supporting materials into clearly labeled appendices (A, B, C, etc.).
2. Include resumes for all key personnel with education, certifications, and relevant experience highlighted.
3. Provide detailed past performance reference sheets for each referenced contract.
4. List all relevant certifications and licenses with issuing authority and dates.
5. Include any technical diagrams, architecture drawings, or process flows referenced in the proposal.
6. Reference each appendix from the main proposal body.
7. Use personnel and certification data from the Knowledge Base if available.
8. Return ONLY valid JSON in the required format.`,

  MANAGEMENT_PROPOSAL: `
YOUR TASK — Management Proposal:
1. Present a comprehensive management volume covering organizational structure, key personnel, and program management approach.
2. Include a clear org chart with reporting relationships and customer POC chain.
3. Profile each key person with role, qualifications, certifications, and relevant experience.
4. Describe communication plan, reporting cadence, and escalation procedures.
5. Cover risk management, quality management, and security/compliance approach.
6. Reference specific frameworks and standards with measurable SLAs.
7. Return ONLY valid JSON in the required format.`,

  PRICE_VOLUME: `
YOUR TASK — Price Volume:
1. Present a complete price/cost volume with CLIN-level pricing breakdown.
2. Provide basis of estimate with methodology, assumptions, and labor rate justification.
3. Include escalation factors for multi-year contracts and ODC breakdown.
4. Write a cost narrative demonstrating best value, cost realism, and reasonableness.
5. Ensure full traceability between technical approach and cost elements.
6. Do NOT invent specific dollar amounts — use methodology descriptions if actual rates are not in context.
7. Return ONLY valid JSON in the required format.`,

  QUALITY_MANAGEMENT: `
YOUR TASK — Quality Management Plan:
1. Describe your quality management philosophy and framework (ISO 9001, CMMI, Six Sigma).
2. Detail QA activities: audits, reviews, process assessments, and independent QA function.
3. Describe QC processes: checkpoints, peer reviews, testing, and defect tracking for each deliverable type.
4. Define performance metrics and KPIs with measurement methodology and corrective action thresholds.
5. Explain your continuous improvement process: lessons learned, root cause analysis, process improvement.
6. Describe customer satisfaction management: feedback collection, survey process, and escalation path.
7. Include measurable quality commitments (e.g., "99.5% on-time delivery").
8. Return ONLY valid JSON in the required format.`,
};

const DEFAULT_TASK = (typeLabel: string) => `
YOUR TASK — ${typeLabel}:
1. ANALYZE the solicitation to identify ALL requirements relevant to this document type.
2. DEVELOP 2-3 win themes based on the company's strengths from the provided context.
3. WRITE each section with substantial, detailed content (2-5 paragraphs per subsection, 150-400 words each).
4. SUPPORT every claim with evidence from past performance, knowledge base, and content library.
5. ENSURE every relevant requirement from the solicitation is addressed.
6. MAINTAIN customer focus throughout — write from the customer's perspective.
7. Return ONLY valid JSON in the required format. No text outside the JSON object.`;

/**
 * Build a tailored user prompt for a specific document type.
 * Each document type gets focused task instructions that direct the model
 * to use the most relevant context and produce the right content.
 */
export function buildUserPromptForDocumentType(
  documentType: string,
  solicitation: string,
  qaText: string,
  enrichedKbText: string,
): string {
  const typeLabel =
    RFP_DOCUMENT_TYPES[documentType as keyof typeof RFP_DOCUMENT_TYPES] ??
    documentType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  const taskInstructions = DOC_TYPE_TASK[documentType] ?? DEFAULT_TASK(typeLabel);

  return `
═══════════════════════════════════════
SOLICITATION / RFP DOCUMENTS
═══════════════════════════════════════
The following is the full text of the solicitation document(s). This is your PRIMARY source of requirements.
Carefully identify ALL requirements, evaluation criteria (Section M), and submission instructions (Section L).

${solicitation || 'No solicitation text provided.'}

═══════════════════════════════════════
QUESTIONS & ANSWERS
═══════════════════════════════════════
These are previously answered questions about this opportunity. Use these answers as authoritative content
for your document sections. Each Q&A pair represents validated information about the company's approach.

${qaText || 'No Q&A pairs available.'}

═══════════════════════════════════════
ENRICHMENT CONTEXT (Knowledge Base, Past Performance, Executive Brief, Content Library)
═══════════════════════════════════════
The following context has been gathered from multiple sources. Use it to enrich your ${typeLabel} with:
- Company-specific capabilities, processes, and personnel (Knowledge Base)
- Relevant past contract performance and quantified results (Past Performance)
- Pre-analyzed opportunity intelligence: risks, requirements, scoring, contacts (Executive Brief)
- Pre-approved content snippets for consistent messaging (Content Library)

${enrichedKbText || 'No enrichment context available.'}

═══════════════════════════════════════
${taskInstructions.trim()}
`.trim();
}
