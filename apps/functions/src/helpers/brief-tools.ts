/**
 * Claude Tool Use definitions and executors for executive brief generation.
 *
 * These tools allow Claude to actively query the database during brief section
 * generation rather than relying solely on pre-fetched context.
 *
 * Available tools (6 total):
 *  - search_knowledge_base          → semantic search over company KB
 *  - search_past_performance        → semantic search over past projects
 *  - get_organization_context       → org details, primary contact, project, team
 *  - get_content_library            → search pre-approved content snippets
 *  - get_completed_brief_sections   → access already-completed brief sections
 *  - get_deadlines                  → deadline information for the opportunity
 */

import { searchPastProjects, getPastProject } from './past-performance';
import { queryCompanyKnowledgeBase } from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { requireEnv } from './env';
import { truncateText } from './executive-opportunity-brief';
import { getExecutiveBrief } from './executive-opportunity-brief';
import {
  fetchOrganizationDetails,
  fetchOrgPrimaryContact,
  fetchProjectDetails,
  fetchTeamMembers,
  fetchContentLibraryMatches,
  fetchDeadlineInfo,
  logToolUsage,
} from './db-tool-helpers';
import type { ToolResult } from '@/types/tool';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const BRIEF_TOOLS = [
  {
    name: 'search_knowledge_base',
    description:
      'Search the company knowledge base for relevant capabilities, processes, certifications, ' +
      'or personnel information. Use this to find specific company details that support ' +
      'the brief section you are generating.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query. Example: "ISO certifications quality management" or "key personnel"',
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
    name: 'search_past_performance',
    description:
      'Search for relevant past performance projects by keywords. ' +
      'Use this when generating scoring or requirements sections that need to assess ' +
      'the company\'s relevant experience against the opportunity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'string',
          description: 'Search keywords. Example: "cloud migration AWS federal" or "cybersecurity FISMA"',
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
    name: 'get_organization_context',
    description:
      'Retrieve organization, primary contact, project, and team member information. ' +
      'Use this when the brief section needs company-specific details.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_content_library',
    description:
      'Search the organization\'s content library for pre-approved content snippets. ' +
      'Use this when you need standard language for certifications, compliance statements, ' +
      'or recurring themes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query. Example: "ISO 9001 certification" or "small business status"',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of content items to return (1–5). Default: 3.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_completed_brief_sections',
    description:
      'Retrieve data from already-completed sections of this executive brief. ' +
      'Use this in the scoring section to access summary, requirements, risks, contacts, ' +
      'and deadlines data generated in prior steps. ' +
      'Only COMPLETE sections are returned — in-progress or failed sections are excluded.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sections: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['summary', 'requirements', 'risks', 'contacts', 'deadlines', 'pastPerformance'],
          },
          description: 'Which sections to retrieve.',
        },
      },
      required: ['sections'],
    },
  },
  {
    name: 'get_deadlines',
    description:
      'Retrieve deadline information for this opportunity. ' +
      'Returns submission deadlines, Q&A periods, site visit dates, and other key dates.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;

export type BriefToolName = typeof BRIEF_TOOLS[number]['name'];

// ─── Tool executors ───────────────────────────────────────────────────────────

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
    console.warn('search_knowledge_base (brief) tool error:', (err as Error)?.message);
    return `Error searching knowledge base: ${(err as Error)?.message}`;
  }
};

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
        if (project.value) lines.push(`Value: $${project.value.toLocaleString()}`);
        if (project.performanceRating) lines.push(`Performance Rating: ${project.performanceRating}/5`);
        if (project.description) lines.push(`Description: ${truncateText(project.description, 300)}`);
        if (project.technologies?.length) lines.push(`Technologies: ${project.technologies.slice(0, 6).join(', ')}`);
        if (project.achievements?.length) {
          lines.push('Key Achievements:');
          project.achievements.slice(0, 3).forEach(a => lines.push(`  • ${a}`));
        }
        return lines.join('\n');
      }),
    );

    const validDetails = details.filter((d): d is string => d !== null);
    if (!validDetails.length) return 'Could not load project details.';

    return `Found ${validDetails.length} relevant past performance project(s):\n\n${validDetails.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_past_performance (brief) tool error:', (err as Error)?.message);
    return `Error searching past performance: ${(err as Error)?.message}`;
  }
};

const executeGetOrganizationContext = async (
  orgId: string,
  projectId: string,
): Promise<string> => {
  try {
    const [orgDetails, primaryContact, projectDetails, teamMembers] = await Promise.all([
      fetchOrganizationDetails(orgId),
      fetchOrgPrimaryContact(orgId),
      fetchProjectDetails(projectId),
      fetchTeamMembers(orgId, 10),
    ]);

    const parts = [orgDetails, primaryContact, projectDetails, teamMembers].filter(Boolean);
    return parts.length
      ? parts.join('\n\n')
      : 'No organization context available.';
  } catch (err) {
    console.warn('get_organization_context (brief) tool error:', (err as Error)?.message);
    return 'Could not load organization context.';
  }
};

const executeGetCompletedBriefSections = async (
  executiveBriefId: string,
  sections: string[],
): Promise<string> => {
  try {
    const brief = await getExecutiveBrief(executiveBriefId);
    if (!brief?.sections) return 'No brief sections available.';

    const briefSections = brief.sections as Record<string, { status?: string; data?: unknown }>;
    const parts: string[] = [];

    for (const section of sections) {
      const wrap = briefSections[section];
      if (wrap?.status !== 'COMPLETE' || !wrap?.data) {
        parts.push(`Section "${section}": not yet complete.`);
        continue;
      }
      parts.push(`=== ${section.toUpperCase()} ===`);
      parts.push(JSON.stringify(wrap.data, null, 2));
    }

    return parts.length ? parts.join('\n\n') : 'No completed sections found.';
  } catch (err) {
    console.warn('get_completed_brief_sections tool error:', (err as Error)?.message);
    return `Error loading brief sections: ${(err as Error)?.message}`;
  }
};

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export const executeBriefTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId: string;
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, projectId, opportunityId, executiveBriefId } = args;

  const start = Date.now();
  let content: string;
  let result: 'success' | 'failure' = 'success';
  let errorMessage: string | undefined;

  try {
    switch (toolName) {
      case 'search_knowledge_base':
        content = await executeKnowledgeBaseSearch(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        break;

      case 'search_past_performance':
        content = await executePastPerformanceSearch(
          orgId,
          String(toolInput.keywords ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        break;

      case 'get_organization_context':
        content = await executeGetOrganizationContext(orgId, projectId);
        break;

      case 'get_content_library':
        content = await fetchContentLibraryMatches(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        if (!content) content = 'No content library matches found for that query.';
        break;

      case 'get_completed_brief_sections':
        content = await executeGetCompletedBriefSections(
          executiveBriefId,
          Array.isArray(toolInput.sections) ? (toolInput.sections as string[]) : [],
        );
        break;

      case 'get_deadlines':
        content = await fetchDeadlineInfo(projectId, opportunityId);
        if (!content) content = 'No deadline information available for this opportunity.';
        break;

      default:
        content = `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    result = 'failure';
    errorMessage = (err as Error)?.message ?? 'Unknown error';
    content = `Error executing tool "${toolName}": ${errorMessage}`;
    console.error(`Brief tool "${toolName}" failed:`, errorMessage);
  }

  const durationMs = Date.now() - start;
  console.log(`Brief tool "${toolName}" executed: ${content.length} chars, ${durationMs}ms`);

  // Non-blocking audit log
  logToolUsage({
    orgId,
    resourceId: executiveBriefId,
    toolName,
    toolInput,
    resultLength: content.length,
    resultEmpty: content.length === 0,
    durationMs,
    result,
    errorMessage,
  }).catch(err => console.warn('Failed to write brief tool audit log (non-blocking):', (err as Error)?.message));

  return { tool_use_id: toolUseId, content };
};
