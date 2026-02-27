/**
 * Claude Tool Use definitions and executors for RFP document generation.
 *
 * These tools allow Claude to actively query the database during document
 * generation rather than relying solely on pre-fetched context.
 *
 * Available tools:
 *  - search_past_performance  → semantic search over past projects
 *  - search_knowledge_base    → semantic search over company KB
 *  - get_qa_answers           → filter Q&A pairs by topic
 */

import { searchPastProjects, getPastProject } from './past-performance';
import { queryCompanyKnowledgeBase } from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { requireEnv } from './env';
import { truncateText } from './executive-opportunity-brief';
import type { QaPair } from './document-generation';
import { getProjectById } from './project';
import { getOrgMembers } from './user';
import { docClient } from './db';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { ORG_PK } from '@/constants/organization';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Tool schemas (Claude tool_use format) ────────────────────────────────────

export const DOCUMENT_TOOLS = [
  {
    name: 'search_past_performance',
    description:
      'Search for relevant past performance projects by keywords. ' +
      'Use this when generating Past Performance, Technical Proposal, or any document ' +
      'that requires citing relevant past contracts. Returns project details including ' +
      'title, client, description, technologies, achievements, and performance ratings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'string',
          description:
            'Search keywords describing the type of work, technology, domain, or client. ' +
            'Example: "cloud migration AWS federal agency" or "cybersecurity FISMA compliance"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1–5). Default: 3.',
        },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Search the company knowledge base for relevant capabilities, processes, certifications, ' +
      'or personnel information. Use this when you need specific company details to support ' +
      'a section (e.g., certifications for a Technical Proposal, management processes for ' +
      'Management Approach, or team qualifications).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Search query describing what company information you need. ' +
            'Example: "ISO certifications quality management" or "key personnel program manager"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of KB chunks to return (1–5). Default: 3.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_qa_answers',
    description:
      'Retrieve Q&A pairs relevant to a specific topic from the project\'s question-answer database. ' +
      'Use this to find pre-answered questions about the solicitation that are relevant to the ' +
      'section you are writing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description:
            'Topic or keyword to filter Q&A pairs. ' +
            'Example: "security clearance" or "period of performance" or "pricing"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of Q&A pairs to return (1–10). Default: 5.',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_organization_context',
    description:
      'Retrieve organization, project, and team member information in a single call. ' +
      'Use this when you need to fill in company-specific details such as: ' +
      'company name, address, contact information, signatory details (name, title, email, phone), ' +
      'team member names and roles, project name, or any other organizational metadata. ' +
      'Always call this tool when generating Cover Letters, Commitment Statements, ' +
      'Team Qualifications, or any section requiring real company/personnel details.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;

export type ToolName = typeof DOCUMENT_TOOLS[number]['name'];

// ─── Tool result type ─────────────────────────────────────────────────────────

export interface ToolResult {
  tool_use_id: string;
  content: string;
}

// ─── Tool executors ───────────────────────────────────────────────────────────

const executePastPerformanceSearch = async (
  orgId: string,
  keywords: string,
  limit = 3,
): Promise<string> => {
  const topK = Math.min(Math.max(limit, 1), 5);
  try {
    const results = await searchPastProjects(orgId, keywords, topK * 2);
    if (!results.length) return 'No past performance projects found matching those keywords.';

    const relevant = results.filter(r => r.score >= 0.35).slice(0, topK);
    if (!relevant.length) return 'No sufficiently relevant past performance projects found.';

    const details = await Promise.all(
      relevant.map(async (r) => {
        const project = await getPastProject(orgId, r.projectId).catch(() => null);
        if (!project) return null;

        const lines: string[] = [
          `**${project.title}** (relevance: ${Math.round(r.score * 100)}%)`,
          `Client: ${project.client}`,
        ];
        if (project.domain) lines.push(`Domain: ${project.domain}`);
        if (project.contractNumber) lines.push(`Contract: ${project.contractNumber}`);
        if (project.value) lines.push(`Value: $${project.value.toLocaleString()}`);
        if (project.startDate || project.endDate) {
          lines.push(`Period: ${project.startDate || '?'} – ${project.endDate || 'Present'}`);
        }
        if (project.teamSize) lines.push(`Team Size: ${project.teamSize}`);
        if (project.performanceRating) lines.push(`Performance Rating: ${project.performanceRating}/5`);
        if (project.description) lines.push(`Description: ${truncateText(project.description, 300)}`);
        if (project.technicalApproach) lines.push(`Technical Approach: ${truncateText(project.technicalApproach, 200)}`);
        if (project.technologies?.length) lines.push(`Technologies: ${project.technologies.slice(0, 8).join(', ')}`);
        if (project.achievements?.length) {
          lines.push(`Key Achievements:`);
          project.achievements.slice(0, 4).forEach(a => lines.push(`  • ${a}`));
        }
        if (project.naicsCodes?.length) lines.push(`NAICS: ${project.naicsCodes.join(', ')}`);
        return lines.join('\n');
      }),
    );

    const validDetails = details.filter((d): d is string => d !== null);
    if (!validDetails.length) return 'Could not load project details.';

    return `Found ${validDetails.length} relevant past performance project(s):\n\n${validDetails.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_past_performance tool error:', (err as Error)?.message);
    return `Error searching past performance: ${(err as Error)?.message}`;
  }
};

const executeKnowledgeBaseSearch = async (
  orgId: string,
  query: string,
  limit = 3,
): Promise<string> => {
  const topK = Math.min(Math.max(limit, 1), 5);
  try {
    const matches = await queryCompanyKnowledgeBase(orgId, query, topK * 2);
    if (!matches?.length) return 'No knowledge base content found for that query.';

    const relevant = matches.filter(m => (m.score ?? 0) >= 0.40).slice(0, topK);
    if (!relevant.length) return 'No sufficiently relevant knowledge base content found.';

    const chunks = await Promise.all(
      relevant.map(async (m, i) => {
        const text = m.source?.chunkKey
          ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
          : '';
        if (!text.trim()) return null;
        return `[KB ${i + 1}] (score: ${m.score?.toFixed(2)})\n${truncateText(text, 600)}`;
      }),
    );

    const validChunks = chunks.filter((c): c is string => c !== null);
    if (!validChunks.length) return 'Could not load knowledge base content.';

    return `Found ${validChunks.length} relevant knowledge base excerpt(s):\n\n${validChunks.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_knowledge_base tool error:', (err as Error)?.message);
    return `Error searching knowledge base: ${(err as Error)?.message}`;
  }
};

const executeGetQaAnswers = (
  qaPairs: QaPair[],
  topic: string,
  limit = 5,
): string => {
  const topK = Math.min(Math.max(limit, 1), 10);
  const topicLower = topic.toLowerCase();
  const keywords = topicLower.split(/\s+/).filter(w => w.length > 3);

  const scored = qaPairs
    .filter(qa => qa.answer?.trim())
    .map(qa => {
      const text = `${qa.question} ${qa.answer}`.toLowerCase();
      const matchCount = keywords.filter(k => text.includes(k)).length;
      return { qa, matchCount };
    })
    .filter(({ matchCount }) => matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, topK);

  if (!scored.length) return `No Q&A pairs found related to "${topic}".`;

  const formatted = scored.map(({ qa }, i) =>
    `Q${i + 1}: ${qa.question}\nA${i + 1}: ${truncateText(qa.answer, 400)}`
  ).join('\n\n');

  return `Found ${scored.length} relevant Q&A pair(s) for "${topic}":\n\n${formatted}`;
};

// ─── Organization context executor ───────────────────────────────────────────

const executeGetOrganizationContext = async (
  orgId: string,
  projectId: string,
): Promise<string> => {
  try {
    const parts: string[] = [];

    // Load organization details
    try {
      const orgRes = await docClient.send(new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: ORG_PK, [SK_NAME]: `ORG#${orgId}` },
      }));
      const org = orgRes.Item as Record<string, unknown> | undefined;
      if (org) {
        parts.push('=== ORGANIZATION ===');
        if (org.name) parts.push(`Company Name: ${org.name}`);
        if (org.description) parts.push(`Description: ${org.description}`);
        if (org.website) parts.push(`Website: ${org.website}`);
        if (org.address) parts.push(`Address: ${org.address}`);
        if (org.phone) parts.push(`Phone: ${org.phone}`);
        if (org.email) parts.push(`Email: ${org.email}`);
        if (org.cage) parts.push(`CAGE Code: ${org.cage}`);
        if (org.duns) parts.push(`DUNS/UEI: ${org.duns}`);
        if (org.naicsCodes) parts.push(`NAICS Codes: ${org.naicsCodes}`);
        if (org.businessType) parts.push(`Business Type: ${org.businessType}`);
        if (org.setAside) parts.push(`Set-Aside: ${org.setAside}`);
        if (org.slug) parts.push(`Slug: ${org.slug}`);
      }
    } catch (err) {
      console.warn('get_organization_context: failed to load org:', (err as Error)?.message);
    }

    // Load project details
    try {
      const project = await getProjectById(projectId);
      if (project) {
        parts.push('\n=== PROJECT ===');
        if ((project as any).name) parts.push(`Project Name: ${(project as any).name}`);
        if ((project as any).description) parts.push(`Project Description: ${(project as any).description}`);
      }
    } catch (err) {
      console.warn('get_organization_context: failed to load project:', (err as Error)?.message);
    }

    // Load team members (up to 10)
    try {
      const members = await getOrgMembers(orgId);
      if (members?.length) {
        parts.push('\n=== TEAM MEMBERS ===');
        members.slice(0, 10).forEach((m: any) => {
          const line: string[] = [];
          if (m.name || m.displayName) line.push(m.name || m.displayName);
          if (m.title || m.jobTitle) line.push(m.title || m.jobTitle);
          if (m.email) line.push(m.email);
          if (m.phone) line.push(m.phone);
          if (m.role) line.push(`(${m.role})`);
          if (line.length) parts.push(`• ${line.join(' | ')}`);
        });
      }
    } catch (err) {
      console.warn('get_organization_context: failed to load members:', (err as Error)?.message);
    }

    if (parts.length === 0) {
      return 'No organization context available. Use placeholder values like [Company Name], [Contact Name], [Title], [Email], [Phone].';
    }

    return parts.join('\n');
  } catch (err) {
    console.warn('get_organization_context tool error:', (err as Error)?.message);
    return 'Could not load organization context. Use placeholder values like [Company Name], [Contact Name], [Title], [Email], [Phone].';
  }
};

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export const executeDocumentTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  qaPairs: QaPair[];
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, projectId, qaPairs } = args;

  let content: string;

  switch (toolName) {
    case 'search_past_performance':
      content = await executePastPerformanceSearch(
        orgId,
        String(toolInput.keywords ?? ''),
        typeof toolInput.limit === 'number' ? toolInput.limit : 3,
      );
      break;

    case 'search_knowledge_base':
      content = await executeKnowledgeBaseSearch(
        orgId,
        String(toolInput.query ?? ''),
        typeof toolInput.limit === 'number' ? toolInput.limit : 3,
      );
      break;

    case 'get_qa_answers':
      content = executeGetQaAnswers(
        qaPairs,
        String(toolInput.topic ?? ''),
        typeof toolInput.limit === 'number' ? toolInput.limit : 5,
      );
      break;

    case 'get_organization_context':
      content = await executeGetOrganizationContext(orgId, projectId);
      break;

    default:
      content = `Unknown tool: ${toolName}`;
  }

  console.log(`Tool "${toolName}" executed: ${content.length} chars returned`);
  return { tool_use_id: toolUseId, content };
};
