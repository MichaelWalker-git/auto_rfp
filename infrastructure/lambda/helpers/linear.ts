import { LinearClient } from '@linear/sdk';
import { getApiKey } from './api-key-storage';
import { LINEAR_SECRET_PREFIX } from '../constants/linear';
import { requireEnv } from './env';

const LINEAR_TEAM_ID = requireEnv('LINEAR_TEAM_ID', '');
const LINEAR_DEFAULT_ASSIGNEE_ID = requireEnv('LINEAR_DEFAULT_ASSIGNEE_ID', '');
const LINEAR_PROJECT_ID = requireEnv('LINEAR_PROJECT_ID', '');

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
  identifier: string;
  url: string;
}> {
  console.log('Creating Linear ticket...');
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