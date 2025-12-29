import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { PROPOSAL_PK } from '../constants/proposal';

import { type Proposal, ProposalSchema, ProposalStatus, type SaveProposalRequest, } from '@auto-rfp/shared';

export const proposalSK = (projectId: string, proposalId: string) => `${projectId}#${proposalId}`;

export async function saveProposal(
  docClient: any,
  tableName: string,
  input: SaveProposalRequest
): Promise<Proposal> {
  const now = new Date().toISOString();
  const newId = input.id ?? uuidv4();

  const sk = proposalSK(input.projectId, newId);

  const cmd = new UpdateCommand({
    TableName: tableName,
    Key: {
      [PK_NAME]: PROPOSAL_PK,
      [SK_NAME]: sk,
    },
    UpdateExpression: [
      'SET #id = if_not_exists(#id, :newId)',
      '#createdAt = if_not_exists(#createdAt, :now)',
      '#projectId = if_not_exists(#projectId, :projectId)',
      '#updatedAt = :now',
      '#organizationId = :organizationId',
      '#status = :status',
      '#title = :title',
      '#document = :document',
    ].join(', '),
    ExpressionAttributeNames: {
      '#id': 'id',
      '#createdAt': 'createdAt',
      '#updatedAt': 'updatedAt',
      '#projectId': 'projectId',
      '#organizationId': 'organizationId',
      '#status': 'status',
      '#title': 'title',
      '#document': 'document',
    },
    ExpressionAttributeValues: {
      ':newId': newId,
      ':now': now,
      ':projectId': input.projectId,
      ':organizationId': input.organizationId ?? null,
      ':status': input.status ?? ProposalStatus.NEW,
      ':title': input.title ?? input.document.proposalTitle ?? null,
      ':document': input.document,
    },
    ReturnValues: 'ALL_NEW',
  });

  const res = await docClient.send(cmd);
  const attrs = res.Attributes as unknown;

  // Validate/normalize output with shared ProposalSchema
  const parsed = ProposalSchema.safeParse(attrs);
  if (!parsed.success) {
    // keep debugging info but don't crash silently
    console.error('Saved proposal failed schema validation', parsed.error, attrs);
    throw new Error('Saved proposal has invalid shape in DB (does not match ProposalSchema)');
  }

  return parsed.data;
}
