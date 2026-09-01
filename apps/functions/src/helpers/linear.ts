import { LinearClient } from '@linear/sdk';
import type { RfpDigestIssue } from '@auto-rfp/core';
import { getApiKey } from './api-key-storage';
import { LINEAR_SECRET_PREFIX } from '../constants/linear';

// These are optional — only needed when creating/updating tickets.
// Use process.env directly to avoid crashing at import time if not set.
const LINEAR_TEAM_ID = process.env.LINEAR_TEAM_ID || '';
const LINEAR_DEFAULT_ASSIGNEE_ID = process.env.LINEAR_DEFAULT_ASSIGNEE_ID || '';
const LINEAR_PROJECT_ID = process.env.LINEAR_PROJECT_ID || '';

const cache: Map<string, string> = new Map<string, string>();

async function getLinearApiKey(orgId: string): Promise<string> {
  const cachedApiKey = cache.get(orgId);
  if (cachedApiKey) {
    console.log('Using cached Linear API key');
    return cachedApiKey;
  }

  console.log('Fetching Linear API key from Secrets Manager...');

  const apiKey = await getApiKey(orgId, LINEAR_SECRET_PREFIX);

  if (apiKey) {
    cache.set(orgId, apiKey);
    return apiKey;
  }

  if (!cachedApiKey) {
    throw new Error('Could not get Linear API key from Secrets Manager');
  }

  return cachedApiKey;
}

const PROJECT_ISSUES_QUERY = `
  query ProjectIssues($projectId: String!, $after: String) {
    project(id: $projectId) {
      issues(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          identifier
          title
          createdAt
          updatedAt
          startedAt
          completedAt
          state { name }
          assignee { name }
          creator { name }
          labels { nodes { name } }
        }
      }
    }
  }
`;

interface ProjectIssuesResponse {
  project: {
    issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        identifier: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        startedAt: string | null;
        completedAt: string | null;
        state: { name: string } | null;
        assignee: { name: string } | null;
        creator: { name: string } | null;
        labels: { nodes: Array<{ name: string }> };
      }>;
    };
  } | null;
}

/**
 * Lists every issue on a Linear project with the status, labels and transition
 * timestamps the digest needs. Uses a single raw GraphQL query per page —
 * the SDK's lazy relations would otherwise cost one round trip per issue for
 * state, labels, assignee and creator.
 */
export const listProjectIssues = async (
  orgId: string,
  projectId: string,
): Promise<RfpDigestIssue[]> => {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  const issues: RfpDigestIssue[] = [];
  let after: string | null = null;

  do {
    const response: { data?: ProjectIssuesResponse } = await client.client.rawRequest(
      PROJECT_ISSUES_QUERY,
      { projectId, after },
    );

    const page = response.data?.project?.issues;
    if (!page) break;

    for (const node of page.nodes) {
      issues.push({
        identifier: node.identifier,
        title: node.title,
        status: node.state?.name ?? '',
        labels: node.labels.nodes.map((label) => label.name),
        assigneeName: node.assignee?.name ?? undefined,
        creatorName: node.creator?.name ?? undefined,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        startedAt: node.startedAt ?? undefined,
        completedAt: node.completedAt ?? undefined,
      });
    }

    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  console.log(`[linear] Fetched ${issues.length} issues for project ${projectId}`);
  return issues;
};

export interface CreateLinearTicketParams {
  orgId: string;
  title: string;
  description: string;
  priority?: number;
  dueDate?: string;
  assigneeId?: string;
  teamId?: string;
  projectId?: string;
  labels?: string[];
}

export async function createLinearTicket(params: CreateLinearTicketParams): Promise<{
  id: string;
  identifier: string | null;
  url: string | null;
} | null> {
  console.log('Creating Linear ticket...');
  try {
    const apiKey = await getLinearApiKey(params.orgId);

    const client = new LinearClient({ apiKey });

    const teamId = params.teamId || LINEAR_TEAM_ID;
    if (!teamId) {
      throw new Error('Linear team ID not configured');
    }

    const projectId = params.projectId || LINEAR_PROJECT_ID;

    let labelIds: string[] | undefined;
    if (params.labels && params.labels.length > 0) {
      const team = await client.team(teamId);
      const allLabels = await team.labels();

      labelIds = params.labels
        .map(labelName => {
          const found = allLabels.nodes.find(
            l => l.name.toLowerCase() === labelName.toLowerCase()
          );
          if (!found) {
            console.warn(`⚠️ Label not found: "${labelName}"`);
          }
          return found?.id;
        })
        .filter((id): id is string => !!id);
    }

    const issuePayload = await client.createIssue({
      teamId,
      projectId,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 3,
      dueDate: params.dueDate,
      assigneeId: params.assigneeId || LINEAR_DEFAULT_ASSIGNEE_ID,
      labelIds,
    });

    const createdIssue = await issuePayload.issue;

    if (!createdIssue) {
      throw new Error('Failed to create Linear issue');
    }

    console.log('Created Linear issue:', createdIssue.identifier);

    return {
      id: createdIssue.id,
      identifier: createdIssue.identifier,
      url: createdIssue.url,
    };
  } catch (error) {
    return null;
  }
}

export async function createLinearComment(
  orgId: string,
  issueId: string,
  body: string,
): Promise<{ id: string }> {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  const comment = await client.createComment({
    issueId,
    body,
  });

  const created = await comment.comment;
  if (!created) throw new Error('Failed to create Linear comment');

  console.log(`Created Linear comment on issue ${issueId}`);
  return { id: created.id };
}

export async function reassignLinearTicket(
  orgId: string,
  issueId: string,
  assigneeId: string,
  comment?: string,
): Promise<void> {
  try {
    const apiKey = await getLinearApiKey(orgId);
    const client = new LinearClient({ apiKey });

    await client.updateIssue(issueId, { assigneeId });

    if (comment) {
      await client.createComment({ issueId, body: comment });
    }

    console.log(`✅ Ticket ${issueId} reassigned to ${assigneeId}`);
  } catch (err) {
    console.warn(`[linear] Failed to reassign ticket ${issueId}:`, (err as Error).message);
  }
}

/**
 * Swap a card's gate label on Linear, keyed by human identifier (e.g. "HOR-2628").
 *
 * The RFP-tracking sync stores the Linear identifier (not the internal UUID) on
 * each opportunity, so the approval write-back resolves the issue by identifier
 * first. Adds `addLabel`, removes every label in `removeLabels`, and preserves
 * all other labels the issue carries. Unknown label names are skipped with a
 * warning rather than failing the whole update.
 *
 * Returns true when the issue was found and updated; false when the identifier
 * did not resolve to a Linear issue (caller decides whether that's fatal).
 */
export async function swapLinearGateLabelByIdentifier(
  orgId: string,
  identifier: string,
  addLabel: string,
  removeLabels: string[],
): Promise<boolean> {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  // Resolve the issue by its human identifier (HOR-1234).
  const search = await client.issues({
    filter: { number: { eq: Number(identifier.split('-')[1]) } },
    first: 50,
  });
  const issue = search.nodes.find((n) => n.identifier === identifier);
  if (!issue) {
    console.warn(`[linear] Issue not found for identifier ${identifier}`);
    return false;
  }

  const team = await issue.team;
  const teamId = team?.id;
  if (!teamId) {
    console.warn(`[linear] No team for issue ${identifier}`);
    return false;
  }

  const teamObj = await client.team(teamId);
  const allLabels = await teamObj.labels();
  const labelIdByName = new Map(allLabels.nodes.map((l) => [l.name.toLowerCase(), l.id]));

  const addLabelId = labelIdByName.get(addLabel.toLowerCase());
  if (!addLabelId) {
    console.warn(`[linear] Label to add not found: "${addLabel}" — skipping update for ${identifier}`);
    return false;
  }

  const removeIds = new Set(
    removeLabels
      .map((name) => labelIdByName.get(name.toLowerCase()))
      .filter((id): id is string => !!id),
  );

  const current = await issue.labels();
  const currentIds = current.nodes.map((l) => l.id);

  // Preserve everything except the gate labels we're removing, then add the new one.
  const nextIds = Array.from(new Set([...currentIds.filter((id) => !removeIds.has(id)), addLabelId]));

  await client.updateIssue(issue.id, { labelIds: nextIds });
  console.log(`[linear] ${identifier}: +"${addLabel}" −[${removeLabels.join(', ')}]`);
  return true;
}

export const PHYSICAL_SUBMISSION_LABEL = 'physical submission';

interface ResolvedIssueContext {
  client: LinearClient;
  issue: { id: string; identifier: string; labels: () => Promise<{ nodes: Array<{ id: string }> }> };
  currentIds: string[];
  labelIdByName: Map<string, string>;
}

const resolveIssueContext = async (
  orgId: string,
  identifier: string,
  logPrefix: string,
): Promise<ResolvedIssueContext | null> => {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  const search = await client.issues({
    filter: { number: { eq: Number(identifier.split('-')[1]) } },
    first: 50,
  });
  const issue = search.nodes.find((n) => n.identifier === identifier);
  if (!issue) {
    console.warn(`[linear] ${logPrefix}: issue not found for identifier ${identifier}`);
    return null;
  }

  const team = await issue.team;
  const teamId = team?.id;
  if (!teamId) {
    console.warn(`[linear] ${logPrefix}: no team for issue ${identifier}`);
    return null;
  }

  const teamObj = await client.team(teamId);
  const allLabels = await teamObj.labels();
  const labelIdByName = new Map(allLabels.nodes.map((l) => [l.name.toLowerCase(), l.id]));

  const current = await issue.labels();
  const currentIds = current.nodes.map((l) => l.id);

  return { client, issue, currentIds, labelIdByName };
};

export const addLinearLabelByIdentifier = async (
  orgId: string,
  identifier: string,
  labelName: string,
): Promise<void> => {
  try {
    const ctx = await resolveIssueContext(orgId, identifier, 'addLabel');
    if (!ctx) return;

    const addLabelId = ctx.labelIdByName.get(labelName.toLowerCase());
    if (!addLabelId) {
      console.warn(`[linear] addLabel: label "${labelName}" not found for ${identifier}`);
      return;
    }

    const nextIds = Array.from(new Set([...ctx.currentIds, addLabelId]));
    await ctx.client.updateIssue(ctx.issue.id, { labelIds: nextIds });
    console.log(`[linear] ${identifier}: +"${labelName}"`);
  } catch (err) {
    console.warn(`[linear] addLabel failed for ${identifier}:`, (err as Error).message);
  }
};

export const removeLinearLabelByIdentifier = async (
  orgId: string,
  identifier: string,
  labelName: string,
): Promise<void> => {
  try {
    const ctx = await resolveIssueContext(orgId, identifier, 'removeLabel');
    if (!ctx) return;

    const removeLabelId = ctx.labelIdByName.get(labelName.toLowerCase());
    if (!removeLabelId) {
      console.warn(`[linear] removeLabel: label "${labelName}" not found for ${identifier}`);
      return;
    }

    const nextIds = ctx.currentIds.filter((id) => id !== removeLabelId);
    await ctx.client.updateIssue(ctx.issue.id, { labelIds: nextIds });
    console.log(`[linear] ${identifier}: -"${labelName}"`);
  } catch (err) {
    console.warn(`[linear] removeLabel failed for ${identifier}:`, (err as Error).message);
  }
};

export const syncPhysicalSubmissionLabel = async (
  orgId: string,
  oppId: string,
  isPhysical: boolean,
): Promise<void> => {
  if (!oppId.startsWith('linear-')) {
    return;
  }
  const identifier = oppId.slice('linear-'.length).toUpperCase();
  if (isPhysical) {
    await addLinearLabelByIdentifier(orgId, identifier, PHYSICAL_SUBMISSION_LABEL);
  } else {
    await removeLinearLabelByIdentifier(orgId, identifier, PHYSICAL_SUBMISSION_LABEL);
  }
};

export async function updateLinearTicket(
  orgId: string,
  issueId: string,
  params: {
    title?: string;
    labels?: string[];
  }
): Promise<void> {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  console.log('Updating Linear ticket:', issueId);

  // If labels provided, convert to label IDs
  let labelIds: string[] | undefined;
  if (params.labels && params.labels.length > 0) {
    const issue = await client.issue(issueId);
    const team = await issue.team;
    const teamId = team?.id;

    if (teamId) {
      const teamObj = await client.team(teamId);
      const allLabels = await teamObj.labels();

      labelIds = params.labels
        .map(labelName => {
          const found = allLabels.nodes.find(l => l.name.toLowerCase() === labelName.toLowerCase());
          if (!found) {
            console.warn(`⚠️ Label not found: "${labelName}"`);
          }
          return found?.id;
        })
        .filter((id): id is string => !!id);
    }
  }

  await client.updateIssue(issueId, {
    title: params.title,
    labelIds,
  });

  console.log('✅ Ticket updated');
}