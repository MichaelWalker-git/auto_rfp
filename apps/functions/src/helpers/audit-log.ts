import { createHmac } from 'crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import type { AuditLogEntry, AuditLogPayload, QueryAuditLogs } from '@auto-rfp/core';
import { AUDIT_LOG_PK, AUDIT_LOG_TTL_DAYS } from '@/constants/audit';
import { PK_NAME, SK_NAME } from '@/constants/common';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildAuditLogSK = (
  orgId: string,
  timestamp: string,
  logId: string,
): string => `${orgId}#${timestamp}#${logId}`;

export const buildAuditLogSkPrefix = (orgId: string): string => `${orgId}#`;

export const buildAuditLogSkDatePrefix = (orgId: string, datePrefix: string): string =>
  `${orgId}#${datePrefix}`;

// ─── Integrity Hash ───────────────────────────────────────────────────────────

export const computeIntegrityHash = (payload: AuditLogPayload, secret: string): string => {
  const canonical = JSON.stringify({
    logId: payload.logId,
    timestamp: payload.timestamp,
    userId: payload.userId,
    organizationId: payload.organizationId,
    action: payload.action,
    resource: payload.resource,
    resourceId: payload.resourceId,
    result: payload.result,
  });
  return createHmac('sha256', secret).update(canonical).digest('hex');
};

// ─── Write (immutable — PutCommand only, no update/delete) ───────────────────

export const writeAuditLog = async (
  payload: AuditLogPayload,
  hmacSecret: string,
): Promise<AuditLogEntry> => {
  const integrityHash = computeIntegrityHash(payload, hmacSecret);
  const ttl = Math.floor(Date.now() / 1000) + AUDIT_LOG_TTL_DAYS * 86400;

  const entry = {
    ...payload,
    integrityHash,
    ttl,
    [PK_NAME]: AUDIT_LOG_PK,
    [SK_NAME]: buildAuditLogSK(payload.organizationId, payload.timestamp, payload.logId),
  };

  // Use raw PutCommand — NOT createItem — because:
  // 1. We never want a ConditionExpression that could reject duplicate logIds
  // 2. We manage createdAt/updatedAt ourselves (timestamp field)
  await docClient.send(new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: entry,
  }));

  return entry as AuditLogEntry;
};

// ─── Query (read-only) ────────────────────────────────────────────────────────

export const queryAuditLogs = async (
  params: QueryAuditLogs,
): Promise<{ items: AuditLogEntry[]; nextToken?: string }> => {
  const { orgId, userId, action, resource, resourceId, result, fromDate, toDate, limit, nextToken } = params;

  // Build SK range condition
  let keyCondition = '#pk = :pk AND begins_with(#sk, :skPrefix)';
  const names: Record<string, string> = { '#pk': PK_NAME, '#sk': SK_NAME };
  const values: Record<string, string> = {
    ':pk': AUDIT_LOG_PK,
    ':skPrefix': buildAuditLogSkPrefix(orgId),
  };

  // If date range provided, use SK range instead of begins_with
  if (fromDate && toDate) {
    keyCondition = '#pk = :pk AND #sk BETWEEN :skFrom AND :skTo';
    values[':skFrom'] = buildAuditLogSkDatePrefix(orgId, fromDate);
    values[':skTo'] = buildAuditLogSkDatePrefix(orgId, toDate + '\uffff');
    delete values[':skPrefix'];
  }

  // Build filter expression for additional fields
  const filterParts: string[] = [];
  if (userId) { names['#userId'] = 'userId'; values[':userId'] = userId; filterParts.push('#userId = :userId'); }
  if (action) { names['#action'] = 'action'; values[':action'] = action; filterParts.push('#action = :action'); }
  if (resource) { names['#resource'] = 'resource'; values[':resource'] = resource; filterParts.push('#resource = :resource'); }
  if (resourceId) { names['#resourceId'] = 'resourceId'; values[':resourceId'] = resourceId; filterParts.push('#resourceId = :resourceId'); }
  if (result) { names['#result'] = 'result'; values[':result'] = result; filterParts.push('#result = :result'); }

  const exclusiveStartKey = nextToken
    ? JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'))
    : undefined;

  const res = await docClient.send(new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: keyCondition,
    FilterExpression: filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    Limit: limit,
    ScanIndexForward: false, // newest first
    ExclusiveStartKey: exclusiveStartKey,
  }));

  const newNextToken = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString('base64')
    : undefined;

  return {
    items: (res.Items ?? []) as AuditLogEntry[],
    nextToken: newNextToken,
  };
};
