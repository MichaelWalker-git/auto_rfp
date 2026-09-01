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

export interface LinearTeamMember {
  id: string;
  name: string;
  email: string;
}

const TEAM_MEMBERS_QUERY = `
  query TeamMembers($teamId: String!) {
    team(id: $teamId) {
      members(first: 250) {
        nodes { id name email active }
      }
    }
  }
`;

interface TeamMembersResponse {
  team: {
    members: {
      nodes: Array<{ id: string; name: string; email: string; active: boolean }>;
    };
  } | null;
}

/**
 * Lists the active members of a Linear team so the UI can offer them as
 * assignees. Falls back to the LINEAR_TEAM_ID env when no team is passed —
 * mirrors createLinearTicket, which files into that same team by default.
 */
export const listTeamMembers = async (
  orgId: string,
  teamId?: string,
): Promise<LinearTeamMember[]> => {
  const resolvedTeamId = teamId || LINEAR_TEAM_ID;
  if (!resolvedTeamId) {
    throw new Error('Linear team ID not configured');
  }

  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  const response: { data?: TeamMembersResponse } = await client.client.rawRequest(
    TEAM_MEMBERS_QUERY,
    { teamId: resolvedTeamId },
  );

  const nodes = response.data?.team?.members.nodes ?? [];
  return nodes
    .filter((node) => node.active)
    .map((node) => ({ id: node.id, name: node.name, email: node.email }));
};

export interface CreateLinearTicketParams {
  orgId: string;
  title: string;
  description: string;
  priority?: number;
  dueDate?: string;
  assigneeId?: string;
  /**
   * Workflow status NAME to start the issue in (resolved to a state id on the
   * team). Omit for the team default. Paired with `labels` so the RFP board
   * reads the intended stage back.
   */
  statusName?: string;
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

    // Resolve label names and (optionally) the status name against the team in
    // one fetch, so the created issue lands in the intended RFP board stage.
    let labelIds: string[] | undefined;
    let stateId: string | undefined;
    if ((params.labels && params.labels.length > 0) || params.statusName) {
      const team = await client.team(teamId);

      if (params.labels && params.labels.length > 0) {
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

      if (params.statusName) {
        const states = await team.states();
        const found = states.nodes.find(
          s => s.name.toLowerCase() === params.statusName!.toLowerCase(),
        );
        if (!found) {
          console.warn(`⚠️ Status not found: "${params.statusName}"`);
        }
        stateId = found?.id;
      }
    }

    const issuePayload = await client.createIssue({
      teamId,
      projectId,
      title: params.title,
      description: params.description,
      priority: params.priority ?? 3,
      dueDate: params.dueDate,
      assigneeId: params.assigneeId || LINEAR_DEFAULT_ASSIGNEE_ID,
      // Undefined lets Linear apply the team's default state; a value pins the column.
      stateId,
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
    // Returning null is the contract (callers treat it as "not created"), but the
    // cause must reach the logs — a swallowed 'Linear team ID not configured' here
    // otherwise looks identical to a Linear API hiccup in production.
    console.error('createLinearTicket failed:', error instanceof Error ? error.message : error);
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

/**
 * Move an issue into an RFP board stage: set the workflow status (resolved from
 * its name on the issue's team) and swap labels (add the stage's gate label,
 * remove the others). This is the inverse of resolveRfpStage, so the board reads
 * the same stage back on the next 15-min sync. Non-gate labels are preserved.
 *
 * Returns true on success; false if the target status name doesn't exist on the
 * team (logged — the caller surfaces it).
 */
export async function setLinearIssueStage(
  orgId: string,
  issueId: string,
  params: { status: string; addLabels: string[]; removeLabels: string[] },
): Promise<boolean> {
  const apiKey = await getLinearApiKey(orgId);
  const client = new LinearClient({ apiKey });

  const issue = await client.issue(issueId);
  const team = await issue.team;
  const teamId = team?.id;
  if (!teamId) {
    console.warn(`[linear] No team for issue ${issueId}`);
    return false;
  }

  const teamObj = await client.team(teamId);

  // Resolve the target workflow state by name.
  const states = await teamObj.states();
  const targetState = states.nodes.find(
    (s) => s.name.toLowerCase() === params.status.toLowerCase(),
  );
  if (!targetState) {
    console.warn(`[linear] Status "${params.status}" not found on team ${teamId}`);
    return false;
  }

  // Resolve label names → ids on this team.
  const allLabels = await teamObj.labels();
  const labelIdByName = new Map(allLabels.nodes.map((l) => [l.name.toLowerCase(), l.id]));

  const addIds = params.addLabels
    .map((name) => {
      const id = labelIdByName.get(name.toLowerCase());
      if (!id) console.warn(`[linear] Label to add not found: "${name}"`);
      return id;
    })
    .filter((id): id is string => !!id);

  const removeIds = new Set(
    params.removeLabels
      .map((name) => labelIdByName.get(name.toLowerCase()))
      .filter((id): id is string => !!id),
  );

  const current = await issue.labels();
  const currentIds = current.nodes.map((l) => l.id);

  // Preserve everything except the labels we're removing, then add the stage labels.
  const nextIds = Array.from(
    new Set([...currentIds.filter((id) => !removeIds.has(id)), ...addIds]),
  );

  await client.updateIssue(issueId, { stateId: targetState.id, labelIds: nextIds });
  console.log(
    `[linear] ${issueId} → status "${params.status}", +[${params.addLabels.join(', ')}] −[${params.removeLabels.join(', ')}]`,
  );
  return true;
}

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