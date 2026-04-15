/**
 * Common RFP questions that recur across government solicitations.
 * These can be seeded into an org's Content Library with pre-approved answers
 * to improve consistency, reduce RAG costs, and prevent hallucination of
 * factual data (rates, certifications, contacts).
 *
 * Priority:
 *   HIGH   = Answer is stable across opportunities, compliance-sensitive, or frequently asked verbatim
 *   MEDIUM = Answer is mostly reusable but may need minor tailoring per-opportunity
 */

export interface CommonRfpQuestion {
  question: string;
  category: string;
  tags: string[];
  priority: 'HIGH' | 'MEDIUM';
  /** Placeholder answer template. Org admins should replace bracketed sections. */
  answerTemplate: string;
}

export const COMMON_RFP_QUESTIONS: CommonRfpQuestion[] = [
  // ─────────────────────────────────────────────
  // HIGH PRIORITY — Company Overview & Qualifications
  // ─────────────────────────────────────────────
  {
    question: 'Provide a company overview including legal name and leadership.',
    category: 'Company Overview',
    tags: ['company-info', 'leadership'],
    priority: 'HIGH',
    answerTemplate:
      '[Company Legal Name] is a [business type] headquartered in [City, State]. ' +
      'Founded in [year], the company specializes in [core services]. ' +
      'Leadership includes [CEO/President name and title], [CTO name and title], and [other key executives]. ' +
      '[Company] holds a [CAGE code], DUNS [number], and is registered in SAM.gov.',
  },
  {
    question: 'What certifications does your organization currently hold?',
    category: 'Qualifications',
    tags: ['certifications', 'aws-partner'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] currently holds the following certifications and accreditations:\n' +
      '- AWS [Partner Tier] Partner with [list competencies]\n' +
      '- [Small business certifications: 8(a), HUBZone, SDVOSB, WOSB, etc.]\n' +
      '- [Industry certifications: ISO 27001, CMMI Level X, SOC 2 Type II, etc.]\n' +
      '- [Personnel certifications: PMP, AWS Solutions Architect, CISSP, etc.]',
  },
  {
    question: 'How will your organization support the agency\'s small business subcontracting goals?',
    category: 'Qualifications',
    tags: ['small-business', 'set-aside'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] is a [small business designation(s)]. ' +
      'We are committed to maximizing small business participation and maintain an active subcontracting plan ' +
      'that targets [X]% small business utilization. ' +
      'Our teaming partners include [list small business partners and their designations]. ' +
      'We track and report subcontracting goals in accordance with FAR 19.7 requirements.',
  },
  {
    question: 'Describe your team\'s experience with cloud environments and AWS services.',
    category: 'Qualifications',
    tags: ['aws', 'cloud-experience'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] has [X] years of experience delivering cloud solutions on AWS. ' +
      'Our team holds [number] AWS certifications across [list certification types]. ' +
      'Core AWS services we deliver include: [EC2, Lambda, ECS/EKS, RDS, DynamoDB, S3, CloudFormation, etc.]. ' +
      'We have successfully completed [number] cloud migration and modernization projects ' +
      'for federal agencies including [list agencies].',
  },
  {
    question: 'Describe your artificial intelligence and machine learning capabilities.',
    category: 'Technical Capabilities',
    tags: ['ai-ml', 'capabilities'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] delivers AI/ML solutions leveraging [AWS SageMaker, Bedrock, Comprehend, Textract, Rekognition, etc.]. ' +
      'Our capabilities include:\n' +
      '- Natural Language Processing (NLP) and document intelligence\n' +
      '- Machine learning model development, training, and deployment\n' +
      '- Generative AI and large language model integration\n' +
      '- Computer vision and image/document classification\n' +
      '- MLOps pipelines for model monitoring and retraining\n' +
      'We have delivered AI/ML solutions for [list relevant agencies/projects].',
  },

  // ─────────────────────────────────────────────
  // HIGH PRIORITY — Security & Compliance
  // ─────────────────────────────────────────────
  {
    question: 'Describe how your team will comply with security requirements and maintain secure operations throughout the period of performance.',
    category: 'Security',
    tags: ['security', 'compliance'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] maintains a comprehensive security program aligned with NIST 800-53 controls and federal security standards. ' +
      'Our approach includes:\n' +
      '- Encryption at rest (AES-256) and in transit (TLS 1.2+)\n' +
      '- Role-based access control (RBAC) with least-privilege principles\n' +
      '- Continuous monitoring and vulnerability scanning\n' +
      '- Incident response procedures aligned with [NIST 800-61 / agency-specific IR plan]\n' +
      '- Security awareness training for all personnel\n' +
      '- Regular security assessments and penetration testing\n' +
      'All systems are deployed within [FedRAMP authorized / agency ATO] environments.',
  },
  {
    question: 'How will your organization handle sensitive data and ensure compliance with federal security standards?',
    category: 'Security',
    tags: ['data-protection', 'federal-standards'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] implements defense-in-depth data protection measures:\n' +
      '- Data classification and handling procedures per [FIPS 199 / agency data policy]\n' +
      '- Encryption: AES-256 at rest, TLS 1.2+ in transit, AWS KMS for key management\n' +
      '- Access controls: IAM policies, MFA, session management, audit logging\n' +
      '- Data loss prevention (DLP) monitoring\n' +
      '- Compliance with [FISMA, FedRAMP, NIST 800-171, HIPAA, etc.] as applicable\n' +
      '- Regular compliance audits and continuous Authority to Operate (ATO) monitoring',
  },
  {
    question: 'Confirm that all proposed key personnel hold the required qualifications and certifications.',
    category: 'Security',
    tags: ['personnel', 'certifications'],
    priority: 'HIGH',
    answerTemplate:
      'We confirm that all proposed key personnel meet or exceed the required qualifications:\n' +
      '- [Role 1]: [Name] — [certifications, clearance level, years of experience]\n' +
      '- [Role 2]: [Name] — [certifications, clearance level, years of experience]\n' +
      '- [Role 3]: [Name] — [certifications, clearance level, years of experience]\n' +
      'All personnel maintain current certifications and [security clearance level] clearances as required.',
  },

  // ─────────────────────────────────────────────
  // HIGH PRIORITY — Pricing
  // ─────────────────────────────────────────────
  {
    question: 'Provide your proposed labor categories and fully burdened hourly rates.',
    category: 'Pricing',
    tags: ['labor-rates', 'pricing'],
    priority: 'HIGH',
    answerTemplate:
      'The following fully burdened hourly rates are proposed for this engagement:\n\n' +
      '| Labor Category | Year 1 Rate | Year 2 Rate | Year 3 Rate |\n' +
      '|---|---|---|---|\n' +
      '| [Program Manager] | [$X.XX] | [$X.XX] | [$X.XX] |\n' +
      '| [Senior Developer] | [$X.XX] | [$X.XX] | [$X.XX] |\n' +
      '| [Developer] | [$X.XX] | [$X.XX] | [$X.XX] |\n' +
      '| [DevOps Engineer] | [$X.XX] | [$X.XX] | [$X.XX] |\n' +
      '| [UX Designer] | [$X.XX] | [$X.XX] | [$X.XX] |\n\n' +
      'Rates are based on [GSA Schedule / contract vehicle] and include [fringe, overhead, G&A, profit].',
  },
  {
    question: 'Describe your pricing methodology and how your proposed costs represent best value to the Government.',
    category: 'Pricing',
    tags: ['pricing-methodology', 'best-value'],
    priority: 'HIGH',
    answerTemplate:
      '[Company] pricing methodology is designed to deliver best value through:\n' +
      '- Competitive fully burdened rates based on [GSA Schedule / market research]\n' +
      '- Right-sized staffing aligned to task complexity (avoiding over-staffing)\n' +
      '- Agile delivery reducing waste and rework\n' +
      '- Automation and DevOps practices that reduce operational labor\n' +
      '- Reusable frameworks and accelerators that reduce development time\n' +
      'Our proposed [total cost / blended rate] of [$X] represents [X]% savings compared to [benchmark].',
  },

  // ─────────────────────────────────────────────
  // HIGH PRIORITY — References & Past Performance
  // ─────────────────────────────────────────────
  {
    question: 'Provide references with contact information for past engagements.',
    category: 'Past Performance',
    tags: ['references', 'contacts'],
    priority: 'HIGH',
    answerTemplate:
      'Reference 1:\n' +
      '- Contract: [Contract name/number]\n' +
      '- Agency: [Agency name]\n' +
      '- COR/COTR: [Name], [Phone], [Email]\n' +
      '- Period of Performance: [Start] – [End]\n' +
      '- Contract Value: [$X]\n\n' +
      'Reference 2:\n' +
      '- Contract: [Contract name/number]\n' +
      '- Agency: [Agency name]\n' +
      '- COR/COTR: [Name], [Phone], [Email]\n' +
      '- Period of Performance: [Start] – [End]\n' +
      '- Contract Value: [$X]\n\n' +
      'Reference 3:\n' +
      '- Contract: [Contract name/number]\n' +
      '- Agency: [Agency name]\n' +
      '- COR/COTR: [Name], [Phone], [Email]\n' +
      '- Period of Performance: [Start] – [End]\n' +
      '- Contract Value: [$X]',
  },
  {
    question: 'Provide three examples of contracts of similar size and scope performed within the last five years.',
    category: 'Past Performance',
    tags: ['past-performance', 'case-studies'],
    priority: 'HIGH',
    answerTemplate:
      'Case Study 1: [Contract Name]\n' +
      '- Client: [Agency], Contract #[number]\n' +
      '- Scope: [Brief description of work]\n' +
      '- Value: [$X] | Duration: [X months/years]\n' +
      '- Key Outcomes: [Measurable results]\n\n' +
      'Case Study 2: [Contract Name]\n' +
      '- Client: [Agency], Contract #[number]\n' +
      '- Scope: [Brief description of work]\n' +
      '- Value: [$X] | Duration: [X months/years]\n' +
      '- Key Outcomes: [Measurable results]\n\n' +
      'Case Study 3: [Contract Name]\n' +
      '- Client: [Agency], Contract #[number]\n' +
      '- Scope: [Brief description of work]\n' +
      '- Value: [$X] | Duration: [X months/years]\n' +
      '- Key Outcomes: [Measurable results]',
  },

  // ─────────────────────────────────────────────
  // MEDIUM PRIORITY — Technical Approach
  // ─────────────────────────────────────────────
  {
    question: 'Describe your proposed technical approach to meeting the requirements outlined in the solicitation.',
    category: 'Technical Approach',
    tags: ['technical-approach', 'solution-architecture'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] proposes a cloud-native, serverless-first architecture on AWS:\n' +
      '- **Compute**: [Lambda / ECS Fargate / EKS] for scalable processing\n' +
      '- **Data**: [RDS / DynamoDB / Aurora] for structured data; [S3] for object storage\n' +
      '- **Integration**: [API Gateway / EventBridge / Step Functions] for orchestration\n' +
      '- **Security**: [WAF, GuardDuty, Security Hub, KMS] for defense-in-depth\n' +
      '- **CI/CD**: [CodePipeline / GitHub Actions] with automated testing and deployment\n\n' +
      'Our approach follows the AWS Well-Architected Framework across all five pillars ' +
      'and incorporates [Agile/SAFe] delivery methodology with [2-week sprints].',
  },
  {
    question: 'How will your solution ensure 99.9% system uptime during the period of performance?',
    category: 'Technical Approach',
    tags: ['uptime', 'availability', 'sla'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] achieves [99.9%+] uptime through:\n' +
      '- Multi-AZ deployment architecture for all critical services\n' +
      '- Auto-scaling compute and database resources based on demand\n' +
      '- Health checks, circuit breakers, and automated failover\n' +
      '- Blue/green and canary deployment strategies for zero-downtime releases\n' +
      '- 24/7 monitoring via [CloudWatch, PagerDuty, Datadog] with automated alerting\n' +
      '- Disaster recovery with [RPO/RTO targets] and regular DR testing\n' +
      '- Defined incident response runbooks with [X]-minute response SLAs',
  },
  {
    question: 'What tools and technologies will you use to deliver the data migration services?',
    category: 'Technical Approach',
    tags: ['migration', 'tools'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] employs a proven data migration methodology using:\n' +
      '- **Assessment**: AWS Migration Hub, Application Discovery Service\n' +
      '- **Migration**: AWS DMS, AWS SCT, S3 Transfer Acceleration, DataSync\n' +
      '- **ETL/Transform**: AWS Glue, Step Functions, custom Lambda processors\n' +
      '- **Validation**: Automated data integrity checks, row-count reconciliation, schema validation\n' +
      '- **Cutover**: Blue/green migration with rollback capability\n\n' +
      'Our 6R migration strategy (Rehost, Replatform, Refactor, Repurchase, Retire, Retain) ' +
      'ensures each workload receives the appropriate migration approach.',
  },
  {
    question: 'Describe how your solution will integrate with the agency\'s existing infrastructure and legacy systems.',
    category: 'Technical Approach',
    tags: ['integration', 'legacy-systems'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] approaches legacy integration through:\n' +
      '- API-first architecture using [REST / GraphQL] with versioned endpoints\n' +
      '- AWS API Gateway for managed API proxy and transformation\n' +
      '- Event-driven integration via [EventBridge / SNS / SQS] for async communication\n' +
      '- ETL pipelines via [AWS Glue / Step Functions] for batch data synchronization\n' +
      '- [AWS PrivateLink / VPN / Direct Connect] for secure network connectivity\n' +
      '- Strangler fig pattern for incremental legacy modernization',
  },

  // ─────────────────────────────────────────────
  // MEDIUM PRIORITY — Management
  // ─────────────────────────────────────────────
  {
    question: 'Describe your project management methodology and how you will ensure on-time delivery of all milestones.',
    category: 'Management',
    tags: ['project-management', 'methodology'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] uses a hybrid Agile/PMBOK methodology:\n' +
      '- **Sprint cadence**: [2-week] iterations with defined sprint goals\n' +
      '- **Ceremonies**: Sprint planning, daily standups, sprint review, retrospective\n' +
      '- **Tracking**: [Jira / Azure DevOps] for backlog management and burn-down tracking\n' +
      '- **Reporting**: Weekly status reports, monthly program reviews, EVM metrics\n' +
      '- **Risk management**: Risk register with probability/impact scoring, reviewed bi-weekly\n' +
      '- **Quality gates**: Definition of Done criteria, code reviews, automated testing\n' +
      'Our PMO ensures milestone tracking and early escalation of schedule risks.',
  },
  {
    question: 'Provide an organizational chart showing key personnel and their roles on this contract.',
    category: 'Management',
    tags: ['org-chart', 'key-personnel'],
    priority: 'MEDIUM',
    answerTemplate:
      'Proposed organizational structure:\n\n' +
      '[Program Manager] — Overall contract oversight, client communication\n' +
      '├── [Technical Lead / Architect] — Technical direction, architecture decisions\n' +
      '│   ├── [Senior Developer(s)] — Core development, code reviews\n' +
      '│   ├── [Developer(s)] — Feature development, bug fixes\n' +
      '│   ├── [DevOps Engineer] — CI/CD, infrastructure, monitoring\n' +
      '│   └── [UX Designer] — User research, interface design\n' +
      '├── [QA Lead] — Test strategy, acceptance testing\n' +
      '└── [Scrum Master] — Agile facilitation, impediment removal\n\n' +
      'All key personnel are [full-time / dedicated] to this contract.',
  },
  {
    question: 'How will you handle knowledge transfer during the transition-in period?',
    category: 'Management',
    tags: ['transition', 'knowledge-transfer'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] follows a structured transition-in methodology:\n' +
      '- **Phase 1 — Discovery** ([X] weeks): Shadow incumbent team, document processes, inventory systems\n' +
      '- **Phase 2 — Parallel Operations** ([X] weeks): Joint operations with incumbent for hands-on knowledge transfer\n' +
      '- **Phase 3 — Assumption** ([X] weeks): Full operational responsibility with incumbent available for questions\n\n' +
      'Key activities include:\n' +
      '- Access and credential provisioning\n' +
      '- Documentation review and gap analysis\n' +
      '- System and data inventory\n' +
      '- Runbook creation for operational procedures\n' +
      '- Risk identification for transition period',
  },
  {
    question: 'Describe your approach to risk identification and mitigation throughout the contract lifecycle.',
    category: 'Management',
    tags: ['risk-management', 'mitigation'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] implements proactive risk management:\n' +
      '- **Risk Register**: Maintained in [Jira / Confluence] with probability, impact, and mitigation strategies\n' +
      '- **Identification**: Risk workshops at project kickoff, sprint retrospectives, architecture reviews\n' +
      '- **Assessment**: Probability × Impact scoring matrix (1-5 scale)\n' +
      '- **Mitigation**: Each risk assigned an owner with specific mitigation actions and trigger criteria\n' +
      '- **Monitoring**: Bi-weekly risk review meetings, monthly reporting to government stakeholders\n' +
      '- **Escalation**: Defined escalation path for HIGH risks to Program Manager → Government COR',
  },

  // ─────────────────────────────────────────────
  // MEDIUM PRIORITY — DevOps & Support
  // ─────────────────────────────────────────────
  {
    question: 'Describe your DevOps practices and continuous integration/deployment approach.',
    category: 'Technical Capabilities',
    tags: ['devops', 'ci-cd'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] DevOps practices include:\n' +
      '- **Source Control**: Git with trunk-based development and feature branches\n' +
      '- **CI/CD Pipeline**: [GitHub Actions / CodePipeline / Jenkins] with automated build, test, and deploy\n' +
      '- **Infrastructure as Code**: [AWS CDK / CloudFormation / Terraform] for all infrastructure\n' +
      '- **Containerization**: [Docker / ECS / EKS] for consistent environments\n' +
      '- **Testing**: Unit, integration, e2e, and security (SAST/DAST) tests in every pipeline\n' +
      '- **Monitoring**: [CloudWatch, X-Ray, Datadog] for observability\n' +
      '- **Deployment**: Blue/green and canary deployments with automated rollback',
  },
  {
    question: 'Describe your approach to post-deployment support and ongoing managed services.',
    category: 'Technical Capabilities',
    tags: ['managed-services', 'support'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] provides comprehensive post-deployment support:\n' +
      '- **Support Tiers**: [Tier 1 (Help desk) / Tier 2 (Application) / Tier 3 (Engineering)]\n' +
      '- **SLA Response Times**: P1 Critical: [X min] / P2 High: [X hours] / P3 Medium: [X hours] / P4 Low: [X business days]\n' +
      '- **Monitoring**: 24/7 automated monitoring with alerting and on-call rotation\n' +
      '- **Maintenance Windows**: Scheduled [weekly/monthly] for patches and updates\n' +
      '- **Continuous Improvement**: Monthly service reviews, quarterly roadmap planning\n' +
      '- **Documentation**: Runbooks, architecture decision records, operational playbooks',
  },
  {
    question: 'Describe your approach to ensuring Section 508 accessibility compliance for all deliverables.',
    category: 'Technical Capabilities',
    tags: ['accessibility', 'section-508', 'wcag'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Company] ensures Section 508 / WCAG 2.1 AA compliance through:\n' +
      '- Accessibility requirements integrated into Definition of Done for all user stories\n' +
      '- Semantic HTML, ARIA attributes, and keyboard navigation in all UI components\n' +
      '- Automated accessibility testing with [axe-core / pa11y / Lighthouse] in CI/CD pipeline\n' +
      '- Manual testing with screen readers ([NVDA, VoiceOver, JAWS]) and keyboard-only navigation\n' +
      '- Color contrast validation (minimum 4.5:1 ratio for normal text)\n' +
      '- Voluntary Product Accessibility Template (VPAT) documentation for all deliverables\n' +
      '- Accessibility training for all development team members',
  },

  // ─────────────────────────────────────────────
  // MEDIUM PRIORITY — Key Personnel
  // ─────────────────────────────────────────────
  {
    question: 'Describe the qualifications of your key personnel responsible for infrastructure, deployment, and system reliability.',
    category: 'Key Personnel',
    tags: ['devops', 'infrastructure', 'resume'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Name], [Title] — Infrastructure & DevOps Lead\n' +
      '- [X]+ years of experience in cloud infrastructure and DevOps engineering\n' +
      '- Certifications: [AWS Solutions Architect Professional, AWS DevOps Engineer Professional, etc.]\n' +
      '- Clearance: [Level]\n' +
      '- Key experience:\n' +
      '  - [Project 1]: Designed and deployed [description] for [agency]\n' +
      '  - [Project 2]: Led infrastructure migration for [agency], achieving [results]\n' +
      '- Education: [Degree] in [Field] from [University]',
  },
  {
    question: 'Describe the qualifications of your key personnel responsible for user interface development and web application delivery.',
    category: 'Key Personnel',
    tags: ['frontend', 'ui', 'resume'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Name], [Title] — Frontend / UI Lead\n' +
      '- [X]+ years of experience in frontend development and web application delivery\n' +
      '- Certifications: [AWS Cloud Practitioner, etc.]\n' +
      '- Clearance: [Level]\n' +
      '- Technical skills: [React, Next.js, TypeScript, Tailwind CSS, accessibility/508 compliance]\n' +
      '- Key experience:\n' +
      '  - [Project 1]: Led frontend development for [agency], delivering [results]\n' +
      '  - [Project 2]: Built [description] achieving [measurable outcomes]\n' +
      '- Education: [Degree] in [Field] from [University]',
  },
  {
    question: 'Describe the qualifications of your key personnel responsible for backend development and cloud-native application architecture.',
    category: 'Key Personnel',
    tags: ['backend', 'cloud-native', 'resume'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Name], [Title] — Backend / Cloud Architecture Lead\n' +
      '- [X]+ years of experience in cloud-native application development\n' +
      '- Certifications: [AWS Solutions Architect Professional, AWS Developer Associate, etc.]\n' +
      '- Clearance: [Level]\n' +
      '- Technical skills: [Node.js/Python/Java, AWS Lambda, DynamoDB, microservices, API design]\n' +
      '- Key experience:\n' +
      '  - [Project 1]: Architected serverless platform for [agency], reducing costs by [X]%\n' +
      '  - [Project 2]: Led cloud modernization for [agency], migrating [X] services\n' +
      '- Education: [Degree] in [Field] from [University]',
  },
  {
    question: 'Describe the qualifications of your key personnel responsible for user experience design and usability.',
    category: 'Key Personnel',
    tags: ['ux-design', 'usability', 'resume'],
    priority: 'MEDIUM',
    answerTemplate:
      '[Name], [Title] — UX Design Lead\n' +
      '- [X]+ years of experience in user experience design and research\n' +
      '- Certifications: [Certified Usability Analyst, HFI, etc.]\n' +
      '- Clearance: [Level]\n' +
      '- Technical skills: [Figma, user research, wireframing, prototyping, usability testing, Section 508]\n' +
      '- Key experience:\n' +
      '  - [Project 1]: Redesigned [system] for [agency], improving user satisfaction by [X]%\n' +
      '  - [Project 2]: Led UX for [description], reducing task completion time by [X]%\n' +
      '- Education: [Degree] in [Field] from [University]',
  },
  {
    question: 'Identify key personnel who hold current AWS certifications and describe their relevant project experience.',
    category: 'Key Personnel',
    tags: ['aws-certifications', 'personnel'],
    priority: 'MEDIUM',
    answerTemplate:
      'AWS-certified personnel proposed for this contract:\n\n' +
      '| Name | Role | AWS Certifications | Years Exp. |\n' +
      '|---|---|---|---|\n' +
      '| [Name] | [Role] | [SA Pro, DevOps Pro] | [X] |\n' +
      '| [Name] | [Role] | [SA Associate, Developer] | [X] |\n' +
      '| [Name] | [Role] | [Cloud Practitioner, SysOps] | [X] |\n\n' +
      'Total team AWS certifications: [X]\n' +
      'Key project experience includes [Project 1] for [Agency] and [Project 2] for [Agency].',
  },
];
