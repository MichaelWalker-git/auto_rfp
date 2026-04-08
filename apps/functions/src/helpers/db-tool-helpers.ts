/**
 * Typed DynamoDB query helpers for AI tool consumption.
 *
 * Each helper fetches data from DynamoDB using proper types (no `any` casts)
 * and returns a formatted string ready for AI consumption.
 *
 * These are the single source of truth for how DB data is presented to AI tools.
 * Used by both document-tools.ts and brief-tools.ts.
 */

import { v4 as uuidv4 } from 'uuid';
import type { OrganizationItem, ContentLibraryItem } from '@auto-rfp/core';
import type { DBProjectItem } from '@/types/project';
import type { BriefSectionName } from '@/helpers/executive-opportunity-brief';
import { getItem, queryBySkPrefix } from '@/helpers/db';
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import { getProjectById } from '@/helpers/project';
import { getOrgMembers } from '@/helpers/user';
import { getExecutiveBriefByProjectId, truncateText } from '@/helpers/executive-opportunity-brief';
import { getEmbedding } from '@/helpers/embeddings';
import { semanticSearchContentLibrary } from '@/helpers/semantic-search';
import { ORG_PK } from '@/constants/organization';
import { DEADLINE_PK } from '@/constants/deadline';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';

// ─── Org Details ──────────────────────────────────────────────────────────────

/**
 * Fetch organization details from DynamoDB and format for AI consumption.
 */
export const fetchOrganizationDetails = async (orgId: string): Promise<string> => {
  try {
    const org = await getItem<OrganizationItem>(ORG_PK, `ORG#${orgId}`);
    if (!org) return '';

    const lines: string[] = ['=== ORGANIZATION ==='];
    if (org.name) lines.push(`Company Name: ${org.name}`);
    if (org.description) lines.push(`Description: ${truncateText(org.description, 300)}`);
    if ((org as Record<string, unknown>).website) lines.push(`Website: ${(org as Record<string, unknown>).website}`);
    if ((org as Record<string, unknown>).address) lines.push(`Address: ${(org as Record<string, unknown>).address}`);
    if ((org as Record<string, unknown>).phone) lines.push(`Phone: ${(org as Record<string, unknown>).phone}`);
    if ((org as Record<string, unknown>).email) lines.push(`Email: ${(org as Record<string, unknown>).email}`);
    if ((org as Record<string, unknown>).cage) lines.push(`CAGE Code: ${(org as Record<string, unknown>).cage}`);
    if ((org as Record<string, unknown>).duns) lines.push(`DUNS/UEI: ${(org as Record<string, unknown>).duns}`);
    if ((org as Record<string, unknown>).naicsCodes) lines.push(`NAICS Codes: ${(org as Record<string, unknown>).naicsCodes}`);
    if ((org as Record<string, unknown>).businessType) lines.push(`Business Type: ${(org as Record<string, unknown>).businessType}`);
    if ((org as Record<string, unknown>).setAside) lines.push(`Set-Aside: ${(org as Record<string, unknown>).setAside}`);

    return lines.join('\n');
  } catch (err) {
    console.warn('fetchOrganizationDetails error:', (err as Error)?.message);
    return '';
  }
};

// ─── Primary Contact ──────────────────────────────────────────────────────────

/**
 * Fetch the organization's primary contact (proposal signatory) and format for AI.
 */
export const fetchOrgPrimaryContact = async (orgId: string): Promise<string> => {
  try {
    const contact = await getOrgPrimaryContact(orgId);
    if (!contact) return '';

    const lines: string[] = ['=== PRIMARY CONTACT (PROPOSAL SIGNATORY) ==='];
    lines.push(`Name: ${contact.name}`);
    lines.push(`Title: ${contact.title}`);
    lines.push(`Email: ${contact.email}`);
    if (contact.phone) lines.push(`Phone: ${contact.phone}`);
    if (contact.address) lines.push(`Address: ${contact.address}`);

    return lines.join('\n');
  } catch (err) {
    console.warn('fetchOrgPrimaryContact error:', (err as Error)?.message);
    return '';
  }
};

// ─── Project Details ──────────────────────────────────────────────────────────

/**
 * Fetch project details and format for AI consumption.
 */
export const fetchProjectDetails = async (projectId: string): Promise<string> => {
  try {
    const project = await getProjectById(projectId) as DBProjectItem | null;
    if (!project) return '';

    const lines: string[] = ['=== PROJECT ==='];
    if (project.name) lines.push(`Project Name: ${project.name}`);
    if (project.description) lines.push(`Project Description: ${truncateText(project.description, 300)}`);
    const orgName = (project as Record<string, unknown>).organization as { name?: string } | undefined;
    if (orgName?.name) lines.push(`Organization: ${orgName.name}`);

    // Project contact info (higher priority than org primary contact for proposals)
    const contactInfo = (project as Record<string, unknown>).contactInfo as {
      primaryPocName?: string;
      primaryPocEmail?: string;
      primaryPocPhone?: string;
      primaryPocTitle?: string;
    } | undefined;
    if (contactInfo) {
      const hasContact = contactInfo.primaryPocName || contactInfo.primaryPocEmail;
      if (hasContact) {
        lines.push('');
        lines.push('=== PROJECT PRIMARY CONTACT (use this for proposal signatory and POC) ===');
        if (contactInfo.primaryPocName) lines.push(`Contact Name: ${contactInfo.primaryPocName}`);
        if (contactInfo.primaryPocTitle) lines.push(`Contact Title: ${contactInfo.primaryPocTitle}`);
        if (contactInfo.primaryPocEmail) lines.push(`Contact Email: ${contactInfo.primaryPocEmail}`);
        if (contactInfo.primaryPocPhone) lines.push(`Contact Phone: ${contactInfo.primaryPocPhone}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    console.warn('fetchProjectDetails error:', (err as Error)?.message);
    return '';
  }
};

// ─── Team Members ─────────────────────────────────────────────────────────────

/**
 * Fetch organization team members and format for AI consumption.
 */
export const fetchTeamMembers = async (orgId: string, limit = 10): Promise<string> => {
  try {
    const members = await getOrgMembers(orgId);
    if (!members.length) return '';

    const lines: string[] = ['=== TEAM MEMBERS ==='];
    members.slice(0, limit).forEach((m) => {
      const mRec = m as Record<string, unknown>;
      const parts: string[] = [];
      const displayName = mRec.displayName as string | undefined;
      const name = displayName || m.email;
      if (name) parts.push(name);
      if (displayName && m.email) parts.push(m.email);
      if (mRec.title) parts.push(String(mRec.title));
      if (mRec.role) parts.push(`(${mRec.role})`);
      if (parts.length) lines.push(`• ${parts.join(' | ')}`);
    });

    return lines.join('\n');
  } catch (err) {
    console.warn('fetchTeamMembers error:', (err as Error)?.message);
    return '';
  }
};

// ─── Executive Brief Analysis ─────────────────────────────────────────────────

/**
 * Fetch executive brief analysis data and format for AI consumption.
 * Can return specific sections or all completed sections.
 */
export const fetchExecutiveBriefAnalysis = async (
  projectId: string,
  opportunityId?: string,
  sections?: BriefSectionName[],
): Promise<string> => {
  try {
    const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);
    if (!brief?.sections) return '';

    const briefSections = brief.sections as Record<string, { status?: string; data?: Record<string, unknown> }>;
    const requestedSections = sections ?? (Object.keys(briefSections) as BriefSectionName[]);
    const parts: string[] = [];

    for (const section of requestedSections) {
      const wrap = briefSections[section];
      if (wrap?.status !== 'COMPLETE' || !wrap?.data) continue;
      const data = wrap.data;

      switch (section) {
        case 'summary': {
          parts.push('=== OPPORTUNITY SUMMARY ===');
          if (data.title) parts.push(`Title: ${data.title}`);
          if (data.agency) parts.push(`Agency: ${data.agency}`);
          if (data.office) parts.push(`Office: ${data.office}`);
          if (data.solicitationNumber) parts.push(`Solicitation #: ${data.solicitationNumber}`);
          if (data.naics) parts.push(`NAICS: ${data.naics}`);
          if (data.contractType) parts.push(`Contract Type: ${data.contractType}`);
          if (data.setAside) parts.push(`Set-Aside: ${data.setAside}`);
          if (data.estimatedValueUsd) parts.push(`Estimated Value: $${data.estimatedValueUsd}`);
          if (data.summary) parts.push(`Scope: ${truncateText(String(data.summary), 500)}`);
          break;
        }
        case 'requirements': {
          const reqs = data as {
            overview?: string;
            requirements?: Array<{ mustHave?: boolean; requirement?: string }>;
            deliverables?: string[];
            evaluationFactors?: string[];
          };
          parts.push('\n=== KEY REQUIREMENTS ===');
          if (reqs.overview) parts.push(`Overview: ${reqs.overview}`);
          const mustHaves = (reqs.requirements ?? []).filter(r => r.mustHave).slice(0, 10);
          mustHaves.forEach((r, i) => parts.push(`  ${i + 1}. ${r.requirement}`));
          if (reqs.evaluationFactors?.length) {
            parts.push(`Evaluation Factors: ${reqs.evaluationFactors.slice(0, 8).join(' | ')}`);
          }
          if (reqs.deliverables?.length) {
            parts.push(`Deliverables: ${reqs.deliverables.slice(0, 6).join(', ')}`);
          }
          break;
        }
        case 'risks': {
          const risks = data as {
            redFlags?: Array<{ severity?: string; flag?: string; mitigation?: string }>;
            risks?: Array<{ severity?: string; flag?: string; mitigation?: string }>;
            incumbentInfo?: { knownIncumbent?: boolean; incumbentName?: string };
          };
          const highRisks = [...(risks.redFlags ?? []), ...(risks.risks ?? [])]
            .filter(f => ['HIGH', 'CRITICAL'].includes(f.severity ?? ''))
            .slice(0, 5);
          if (highRisks.length || risks.incumbentInfo?.knownIncumbent) {
            parts.push('\n=== KEY RISKS ===');
            highRisks.forEach(f => {
              parts.push(`  [${f.severity}] ${f.flag}${f.mitigation ? ` → ${f.mitigation}` : ''}`);
            });
            if (risks.incumbentInfo?.knownIncumbent) {
              parts.push(`  Incumbent: ${risks.incumbentInfo.incumbentName || 'Known'}`);
            }
          }
          break;
        }
        case 'contacts': {
          const contacts = data as { contacts?: Array<{ role?: string; name?: string; email?: string; title?: string }> };
          if (contacts.contacts?.length) {
            parts.push('\n=== CONTACTS ===');
            contacts.contacts.slice(0, 5).forEach(c => {
              parts.push(`  ${[c.role, c.name, c.email].filter(Boolean).join(' | ')}`);
            });
          }
          break;
        }
        case 'deadlines': {
          const dl = data as {
            submissionDeadlineIso?: string;
            deadlines?: Array<{ type?: string; dateTimeIso?: string; rawText?: string }>;
          };
          if (dl.submissionDeadlineIso || dl.deadlines?.length) {
            parts.push('\n=== DEADLINES ===');
            if (dl.submissionDeadlineIso) parts.push(`  Submission Deadline: ${dl.submissionDeadlineIso}`);
            (dl.deadlines ?? []).filter(d => d.type !== 'PROPOSAL_DUE').slice(0, 4).forEach(d => {
              parts.push(`  ${d.type}: ${d.dateTimeIso || d.rawText || 'TBD'}`);
            });
          }
          break;
        }
        case 'scoring': {
          const sc = data as { decision?: string; compositeScore?: number; summaryJustification?: string; recommendation?: string };
          if (sc.decision) {
            parts.push('\n=== BID DECISION ===');
            parts.push(`Decision: ${sc.decision}`);
            if (sc.compositeScore) parts.push(`Score: ${sc.compositeScore}/5`);
            if (sc.recommendation) parts.push(`Recommendation: ${sc.recommendation}`);
            if (sc.summaryJustification) {
              parts.push(`Rationale: ${truncateText(sc.summaryJustification, 400)}`);
            }
          }
          break;
        }
      }
    }

    return parts.join('\n').trim();
  } catch (err) {
    console.warn('fetchExecutiveBriefAnalysis error:', (err as Error)?.message);
    return '';
  }
};

// ─── Deadline Info ────────────────────────────────────────────────────────────

/**
 * Fetch deadline information for a project/opportunity.
 * Queries standalone deadline records; falls back to brief deadlines section.
 */
export const fetchDeadlineInfo = async (
  projectId: string,
  opportunityId?: string,
): Promise<string> => {
  try {
    // Try standalone deadline records first
    const skPrefix = opportunityId
      ? `${projectId}#${opportunityId}`
      : `${projectId}#`;

    const deadlineItems = await queryBySkPrefix<Record<string, unknown>>(DEADLINE_PK, skPrefix);

    if (deadlineItems.length) {
      const item = deadlineItems[0]!;
      const lines: string[] = ['=== DEADLINES ==='];

      if (item.submissionDeadlineIso) {
        lines.push(`⚠️  Submission Deadline: ${item.submissionDeadlineIso}`);
      }

      const deadlines = item.deadlines as Array<{ type?: string; label?: string; dateTimeIso?: string; rawText?: string }> | undefined;
      (deadlines ?? []).slice(0, 6).forEach(d => {
        lines.push(`  ${d.type || d.label || 'Deadline'}: ${d.dateTimeIso || d.rawText || 'TBD'}`);
      });

      return lines.join('\n');
    }

    // Fallback: get from executive brief
    return fetchExecutiveBriefAnalysis(projectId, opportunityId, ['deadlines']);
  } catch (err) {
    console.warn('fetchDeadlineInfo error:', (err as Error)?.message);
    return '';
  }
};

// ─── Content Library ──────────────────────────────────────────────────────────

/**
 * Search content library for pre-approved content snippets matching a query.
 * Uses semantic search (embeddings) for relevance matching.
 */
export interface ContentLibraryMatchSource {
  id: string;
  fileName?: string;
  relevance?: number;
  textContent?: string;
}

export const fetchContentLibraryMatches = async (
  orgId: string,
  query: string,
  limit = 5,
): Promise<{ content: string; similarityScores: number[]; sources: ContentLibraryMatchSource[] }> => {
  const empty = { content: '', similarityScores: [] as number[], sources: [] as ContentLibraryMatchSource[] };
  try {
    if (!query.trim()) return empty;

    const embedding = await getEmbedding(query);
    const hits = await semanticSearchContentLibrary(orgId, embedding, limit * 2);
    if (!hits.length) return empty;

    const MIN_SCORE = 0.40;
    const relevant = hits.filter(h => (h.score ?? 0) >= MIN_SCORE).slice(0, limit);
    if (!relevant.length) return empty;

    const similarityScores = relevant.map(h => h.score ?? 0);
    const sources: ContentLibraryMatchSource[] = [];

    // Load matched items from DynamoDB using PK/SK from Pinecone metadata
    const { getItem: getDbItem } = await import('@/helpers/db');
    const items: string[] = [];

    for (const hit of relevant) {
      const pk = hit.source?.[PK_NAME] as string | undefined;
      const sk = hit.source?.[SK_NAME] as string | undefined;
      if (!pk || !sk) continue;

      const item = await getDbItem<ContentLibraryItem>(pk, sk).catch(() => null);
      if (!item?.question || !item?.answer) continue;

      items.push(
        `[Score: ${hit.score?.toFixed(2)}]\nQ: ${item.question}\nA: ${truncateText(item.answer, 400)}`,
      );

      sources.push({
        id: item.id ?? sk,
        fileName: 'Content Library',
        relevance: hit.score ?? undefined,
        textContent: `Q: ${item.question}\nA: ${truncateText(item.answer, 600)}`,
      });
    }

    if (!items.length) return empty;

    return {
      content: `=== CONTENT LIBRARY MATCHES ===\n${items.join('\n\n---\n\n')}`,
      similarityScores,
      sources,
    };
  } catch (err) {
    console.warn('fetchContentLibraryMatches error:', (err as Error)?.message);
    return empty;
  }
};

// ─── Existing RFP Documents ───────────────────────────────────────────────────

/**
 * Fetch list of existing generated RFP documents for a project/opportunity.
 */
export const fetchExistingRfpDocuments = async (
  projectId: string,
  opportunityId?: string,
): Promise<string> => {
  try {
    const skPrefix = opportunityId
      ? `${projectId}#${opportunityId}#`
      : `${projectId}#`;

    const docs = await queryBySkPrefix<Record<string, unknown>>(RFP_DOCUMENT_PK, skPrefix);
    const active = docs.filter(d => !d.deletedAt);
    if (!active.length) return '';

    const lines: string[] = ['=== EXISTING DOCUMENTS ==='];
    active.slice(0, 20).forEach(d => {
      const status = d.status ? ` [${d.status}]` : '';
      lines.push(`  • ${d.documentType || 'UNKNOWN'}: ${d.title || d.name || 'Untitled'}${status}`);
    });

    return lines.join('\n');
  } catch (err) {
    console.warn('fetchExistingRfpDocuments error:', (err as Error)?.message);
    return '';
  }
};

// ─── Audit Logging for Tool Usage ────────────────────────────────────────────

interface LogToolUsageParams {
  orgId: string;
  resourceId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  resultLength: number;
  resultEmpty: boolean;
  durationMs: number;
  result: 'success' | 'failure';
  errorMessage?: string;
}

/**
 * Write a non-blocking audit log entry for an AI tool invocation.
 * Called from tool dispatchers (executeDocumentTool, executeBriefTool).
 */
export const logToolUsage = async (params: LogToolUsageParams): Promise<void> => {
  const {
    orgId,
    resourceId,
    toolName,
    toolInput,
    resultLength,
    resultEmpty,
    durationMs,
    result,
    errorMessage,
  } = params;

  try {
    const hmacSecret = await getHmacSecret();
    await writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: 'system',
        userName: 'system',
        organizationId: orgId,
        action: result === 'success' ? 'AI_TOOL_CALLED' : 'AI_TOOL_FAILED',
        resource: 'ai_tool',
        resourceId,
        changes: {
          after: {
            toolName,
            // Sanitize input — truncate large strings, omit sensitive keys
            toolInput: sanitizeToolInput(toolInput),
            resultLength,
            resultEmpty,
            durationMs,
          },
        },
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result,
        ...(errorMessage && { errorMessage }),
      },
      hmacSecret,
    );
  } catch (err) {
    // Never throw from audit logging — it must not affect the critical path
    console.warn('logToolUsage: failed to write audit log:', (err as Error)?.message);
  }
};

/**
 * Sanitize tool input for audit logging.
 * Truncates large string values to avoid bloating audit records.
 */
const sanitizeToolInput = (input: Record<string, unknown>): Record<string, unknown> => {
  const MAX_VALUE_LENGTH = 200;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
      sanitized[key] = value.slice(0, MAX_VALUE_LENGTH) + '…';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};
